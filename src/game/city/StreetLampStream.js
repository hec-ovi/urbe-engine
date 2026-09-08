import * as THREE from 'three/webgpu';
import { StreetLampPlan } from './StreetLampPlan.js';
import { StreetLampInstances } from './StreetLampInstances.js';

/** Source plans persist; visible instances and collision belong to nearby cells. */
export class StreetLampStream {

	constructor( atlas, factory, walk, { cellSize = 128 } = {} ) {

		if ( ! Number.isFinite( cellSize ) || cellSize < 16 || cellSize > 256 ) throw new Error( 'E_STREET_FIXTURE_WINDOW: cellSize must be 16 to 256 metres' );
		this.cellSize = cellSize;
		this.factory = factory;
		this.plan = new StreetLampPlan( atlas, walk );
		this.group = new THREE.Group(); this.group.name = 'lamps';
		this.cells = new Map(); this.live = new Map();
		this.posts = []; this.glows = [];
		this.settings = { radius: 900, collisionRadius: 256 };
		this.epoch = 0; this.disposed = false;

	}

	get allPostReservations() { return this.plan.posts; }
	get stats() { return { indexed: this.plan.records.length, resident: this.live.size, fixtures: this.glows.length,
		wanted: this.request ? this.#wantedCells().length : 0, pending: Boolean( this.running ) }; }

	update( position, settings = {} ) {

		if ( this.disposed ) return Promise.resolve();
		const next = { ...this.settings, ...settings };
		if ( ! [ position.x, position.z, next.radius, next.collisionRadius ].every( Number.isFinite ) || next.radius < 0 || next.collisionRadius < 0 ) {
			return Promise.reject( new Error( 'E_STREET_FIXTURE_WINDOW: finite position and nonnegative radii are required' ) );
		}
		const view = this.#window( position, next.radius ), collision = this.#window( position, Math.min( next.radius, next.collisionRadius ) );
		const key = [ ...Object.values( view ), ...Object.values( collision ) ].join( ':' );
		const changed = key !== this.request?.key || Object.keys( settings ).some( name => next[ name ] !== this.settings[ name ] );
		this.settings = next;
		if ( changed ) { this.request = { key, view, collision, position: { ...position } }; this.epoch ++; this.#evict(); }
		if ( ! changed && ! this.running ) return Promise.resolve();
		if ( ! this.running ) this.running = this.#run().finally( () => { this.running = null; } );
		return this.running;

	}

	async #catalog() {

		let since = performance.now(), count = 0;
		for ( const _ of this.plan.steps() ) {
			if ( this.disposed ) return;
			if ( ++ count % 256 === 0 && performance.now() - since >= 8 ) { await nextFrame(); since = performance.now(); }
		}
		for ( const record of this.plan.records ) {
			if ( this.disposed ) return;
			const x = Math.floor( record.x / this.cellSize ), z = Math.floor( record.z / this.cellSize ), key = `${x}:${z}`;
			if ( ! this.cells.has( key ) ) this.cells.set( key, { key, x, z, records: [] } );
			this.cells.get( key ).records.push( record );
			if ( ++ count % 256 === 0 && performance.now() - since >= 8 ) { await nextFrame(); since = performance.now(); }
		}
		if ( ! this.disposed ) this.models = new StreetLampInstances( this.factory );

	}

	async #run() {

		this.planning ??= this.#catalog();
		await this.planning;
		while ( ! this.disposed ) {
			const epoch = this.epoch;
			for ( const source of this.#wantedCells() ) {
				if ( this.disposed || epoch !== this.epoch ) break;
				const cell = this.live.get( source.key );
				if ( cell && ( ! this.settings.prepare || cell.prepared === this.settings.prepare )
					&& ( ! this.settings.collision || ! contains( this.request.collision, cell ) || cell.collision === this.settings.collision ) ) continue;
				await this.#admit( source );
				await nextFrame();
			}
			if ( epoch === this.epoch ) return;
		}

	}

	async #admit( source ) {

		const cell = this.live.get( source.key ) ?? { ...source, group: this.models.build( source.records ),
			posts: source.records.flatMap( record => record.post ? [ record.post ] : [] ), glows: source.records.map( record => record.glow ) };
		const wanted = () => ! this.disposed && ! cell.released && contains( this.request.view, cell );
		this.pending = cell;
		try {
			const prepare = this.settings.prepare;
			if ( prepare && cell.prepared !== prepare ) { await prepare( cell.group, { wanted } ); cell.prepared = prepare; }
			if ( ! wanted() ) return;
			const collision = this.settings.collision;
			if ( collision && contains( this.request.collision, cell ) && cell.collision !== collision ) {
				cell.collision?.dropPosts( `lamps:${cell.key}` );
				cell.collision = collision;
				const ready = await collision.addPosts( `lamps:${cell.key}`, cell.posts );
				if ( ready === false ) { collision.dropPosts( `lamps:${cell.key}` ); cell.collision = null; return; }
			}
			if ( ! wanted() ) return;
			if ( ! this.live.has( cell.key ) ) {
				cell.group.name = `lamps:${cell.key}`;
				this.group.add( cell.group ); this.live.set( cell.key, cell );
				this.#publish();
			}
		} catch ( error ) {
			this.#release( cell );
			this.#publish();
			throw error;
		} finally {
			if ( ! this.live.has( cell.key ) ) this.#release( cell );
			this.pending = null;
			if ( cell.released ) this.models.release( cell.group );
		}

	}

	#evict() {

		for ( const cell of this.live.values() ) {
			if ( ! contains( this.request.view, cell ) ) this.#release( cell );
			else if ( cell.collision && ( ! contains( this.request.collision, cell ) || cell.collision !== this.settings.collision ) ) {
				cell.collision.dropPosts( `lamps:${cell.key}` ); cell.collision = null;
			}
		}
		const pending = this.pending;
		if ( pending?.collision && ( ! contains( this.request.collision, pending ) || pending.collision !== this.settings.collision ) ) {
			pending.collision.dropPosts( `lamps:${pending.key}` ); pending.collision = null;
		}
		this.#publish();

	}

	#release( cell ) {

		if ( cell.released ) return;
		cell.released = true;
		cell.collision?.dropPosts( `lamps:${cell.key}` ); cell.collision = null;
		this.live.delete( cell.key ); this.group.remove( cell.group );
		if ( this.pending !== cell ) this.models.release( cell.group );

	}

	#publish() {

		this.posts = [ ...this.live.values() ].flatMap( cell => cell.posts );
		this.glows = [ ...this.live.values() ].flatMap( cell => cell.glows );
		this.settings.changed?.();

	}

	#wantedCells() {

		const found = [];
		for ( let x = this.request.view.x0; x <= this.request.view.x1; x ++ ) for ( let z = this.request.view.z0; z <= this.request.view.z1; z ++ ) {
			const cell = this.cells.get( `${x}:${z}` ); if ( cell ) found.push( cell );
		}
		const { x, z } = this.request.position;
		return found.sort( ( a, b ) => Math.hypot( ( a.x + 0.5 ) * this.cellSize - x, ( a.z + 0.5 ) * this.cellSize - z )
			- Math.hypot( ( b.x + 0.5 ) * this.cellSize - x, ( b.z + 0.5 ) * this.cellSize - z ) );

	}

	#window( { x, z }, radius ) {

		return { x0: Math.floor( ( x - radius ) / this.cellSize ), x1: Math.floor( ( x + radius ) / this.cellSize ),
			z0: Math.floor( ( z - radius ) / this.cellSize ), z1: Math.floor( ( z + radius ) / this.cellSize ) };

	}

	dispose() {

		if ( this.disposal ) return this.disposal;
		this.disposed = true;
		this.pending?.collision?.dropPosts( `lamps:${this.pending.key}` );
		if ( this.pending ) this.pending.collision = null;
		for ( const cell of [ ...this.live.values() ] ) this.#release( cell );
		this.#publish();
		this.disposal = Promise.resolve( this.running ).catch( () => {} ).finally( () => {
			this.models?.dispose(); this.cells.clear();
			this.plan.records = []; this.plan.posts = []; this.plan.glows = []; this.plan.atlas = null; this.plan.walk = null;
		} );
		return this.disposal;

	}

}

function contains( box, cell ) { return cell.x >= box.x0 && cell.x <= box.x1 && cell.z >= box.z0 && cell.z <= box.z1; }
function nextFrame() { return new Promise( resolve => globalThis.requestAnimationFrame ? requestAnimationFrame( resolve ) : setTimeout( resolve, 0 ) ); }
