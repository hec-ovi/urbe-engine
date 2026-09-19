import * as THREE from 'three/webgpu';
import { HitchLog } from '../../debug/HitchLog.js';
import { BuildingsLoader } from '../BuildingsLoader.js';
import { ShellCells } from './ShellCells.js';
import { SkylineGeometry } from './SkylineGeometry.js';
import { releaseShell } from './ReleaseShell.js';

const yieldTask = () => new Promise( resolve => setTimeout( resolve, 0 ) );

/**
 * Cells the stream holds at once: the one it is about to build and one reading
 * behind it, so files arrive while geometry is built and a cell that cannot
 * stand yet is never the only one to choose from.
 */
const READS_AHEAD = 2;

/** Serial spatial admission with original shell geometry and bounded residency. */
export class ShellStream {

	/** @param hitches the log the stream's own steps (showing a cell, dropping one, the skyline) are named in */
	constructor( { catalog, factory, buildings, loadBuildings, cellSize = 128, loadRadius = 250,
		dropRadius = 350, skylineRadius = 1100, prepare, added, removed, onError = console.error,
		hitches = new HitchLog(), loader = new BuildingsLoader( factory ) } ) {

		if ( ! Number.isFinite( cellSize ) || cellSize <= 0 || ! Number.isFinite( loadRadius ) || loadRadius <= 0
			|| ! Number.isFinite( dropRadius ) || dropRadius <= loadRadius || ! Number.isFinite( skylineRadius ) || skylineRadius < dropRadius ) {

			throw new Error( 'E_SHELL_SETTINGS: invalid spatial distances' );

		}
		this.factory = factory;
		this.buildings = buildings;
		this.loadBuildings = loadBuildings;
		this.loader = loader;
		this.loadRadius = loadRadius;
		this.dropRadius = dropRadius;
		this.skylineRadius = skylineRadius;
		this.prepare = prepare;
		this.added = added;
		this.removed = removed;
		this.onError = onError;
		this.hitches = hitches;
		this.grid = new ShellCells( catalog.buildings, cellSize );
		this.group = new THREE.Group();
		this.group.name = 'streamed-city';
		this.doors = [];
		this.entrances = [];
		this.shellColliders = new Map();
		this.centers = new Map( catalog.buildings.map( record => [ record.id, new THREE.Vector3( ...record.center ) ] ) );
		this.pinned = new Set( [ ...buildings ].filter( ( [ , source ] ) => source.hasInterior ).map( ( [ id ] ) => id ) );
		this.resident = new Map();
		this.failed = new Set();
		this.pending = null;
		this.revision = 0;
		this.closed = false;
		this.skyline = null;

	}

	get triangles() {

		return [ ...this.resident.values() ].reduce( ( total, cell ) => total + cell.triangles, 0 );

	}

	async load( position ) {

		this.update( position );
		await this.settled();
		if ( this.failed.size ) throw new Error( 'E_SHELL_LOAD: initial shell admission failed' );
		return this;

	}

	update( position ) {

		if ( this.closed ) return;
		if ( ! Number.isFinite( position.x ) || ! Number.isFinite( position.z ) ) throw new Error( 'E_SHELL_POSITION: expected finite XZ' );
		if ( this.position && Math.hypot( position.x - this.position.x, position.z - this.position.z ) < 16 ) return;
		this.position = { x: position.x, z: position.z };
		this.revision ++;
		this.failed.clear();
		if ( ! this.pending ) this.pending = this.#run().finally( () => { this.pending = null; } );

	}

	async settled() {

		while ( this.pending ) await this.pending;

	}

	async dispose() {

		this.closed = true;
		await this.settled();
		for ( const cell of this.resident.values() ) this.#drop( cell );
		if ( this.skyline ) releaseShell( { group: this.skyline } );
		this.group.removeFromParent();

	}

	#wanted( cell, radius ) {

		return cell.records.some( record => this.pinned.has( record.id ) ) || this.grid.distance( cell, this.position ) <= radius;

	}

	async #run() {

		let seen = - 1;
		while ( ! this.closed && seen !== this.revision ) {

			seen = this.revision;
			const queue = [ ...this.grid.cells.values() ].filter( cell => this.#wanted( cell, this.loadRadius ) );
			queue.sort( ( a, b ) => this.grid.distance( a, this.position ) - this.grid.distance( b, this.position ) );
			const opening = [];

			while ( ! this.closed ) {

				// The nearest cells ask for their files first, a few ahead of the
				// one being built, so a cell reads while another cell is built.
				while ( opening.length < READS_AHEAD && queue.length ) {

					const spatial = queue.shift();
					if ( this.resident.has( spatial.id ) || this.failed.has( spatial.id ) || ! this.#wanted( spatial, this.loadRadius ) ) continue;
					opening.push( this.#open( spatial ) );

				}
				if ( ! opening.length ) break;
				// The nearest cell whose files are here is built next, so a cell
				// still reading steps aside instead of holding up one that can
				// stand. With none of them ready the loop waits for the first,
				// whichever it is. Building itself stays one cell at a time.
				if ( ! opening.some( cell => cell.opened ) ) await Promise.race( opening.map( cell => cell.reads ) );
				const [ next ] = opening.splice( opening.findIndex( cell => cell.opened ), 1 );
				await this.#admit( next );

			}
			if ( this.closed ) return;
			await this.#distant();

		}

	}

	/** Starts everything this cell has to read and answers for it; never rejects. */
	#open( spatial ) {

		const opening = { spatial, opened: false, sources: null, error: null };
		opening.reads = this.#read( spatial ).then(
			sources => { opening.sources = sources; opening.opened = true; },
			error => { opening.error = error; opening.opened = true; }
		);

		return opening;

	}

	/** This cell's building sources, and whatever its loader reads before it builds. */
	async #read( spatial ) {

		const ids = spatial.records.map( record => record.id );
		const missing = ids.filter( id => ! this.buildings.has( id ) );
		const incoming = missing.length ? await this.loadBuildings( missing ) : new Map();
		const sources = new Map( ids.map( id => [ id, this.buildings.get( id ) ?? incoming.get( id ) ] ) );
		if ( [ ...sources ].some( ( [ id, source ] ) => ! source || source.parcelId !== id ) ) throw new Error( 'E_SHELL_SOURCE: catalog/source mismatch' );
		await this.loader.open?.( sources );

		return sources;

	}

	async #admit( opening ) {

		const { spatial } = opening;
		let cell;
		try {

			await opening.reads;
			if ( opening.error ) throw opening.error;
			if ( this.closed || ! this.#wanted( spatial, this.loadRadius ) ) return;
			const sources = opening.sources;
			cell = { ...await this.loader.load( sources ), id: spatial.id, ids: [ ...sources.keys() ], buildings: sources, spatial };
			await this.prepare?.( cell );
			if ( this.closed || ! this.#wanted( spatial, this.loadRadius ) ) {

				this.removed?.( cell );
				releaseShell( cell );
				return;

			}
			this.added?.( cell );
			for ( const [ id, source ] of sources ) this.buildings.set( id, source );
			for ( const [ id, geometry ] of cell.shellColliders ) this.shellColliders.set( id, geometry );
			this.doors.push( ...cell.doors );
			this.entrances.push( ...cell.entrances );
			this.resident.set( cell.id, cell );
			cell.group.visible = false;
			this.group.add( cell.group );

		} catch ( error ) {

			if ( cell ) { this.removed?.( cell ); releaseShell( cell ); }
			this.failed.add( spatial.id );
			this.onError( error );

		}

	}

	async #distant() {

		const retained = new Set( [ ...this.resident.values() ].filter( cell => this.#wanted( cell.spatial, this.dropRadius ) ).map( cell => cell.id ) );
		const geometry = new SkylineGeometry( this.factory );
		const distant = [ ...this.grid.cells.values() ]
			.filter( cell => ! retained.has( cell.id ) && this.grid.distance( cell, this.position ) <= this.skylineRadius );
		for ( let index = 0; index < distant.length; ) {

			if ( this.closed ) return;
			this.hitches.time( 'skyline outline', () => {

				const since = performance.now();
				while ( index < distant.length && performance.now() - since <= 4 ) for ( const record of distant[ index ++ ].records ) geometry.add( record );

			} );
			if ( index < distant.length ) await yieldTask();

		}
		const group = await geometry.finish( yieldTask, this.hitches );
		try { await this.prepare?.( { id: 'skyline', group, ids: [], buildings: new Map(), doors: [], shellColliders: new Map() } ); }
		catch ( error ) { releaseShell( { group } ); this.onError( error ); return; }
		if ( this.closed ) { releaseShell( { group } ); return; }
		for ( const cell of this.resident.values() ) if ( ! retained.has( cell.id ) ) this.hitches.time( `cell ${cell.id} dropped`, () => this.#drop( cell ) );
		if ( this.skyline ) releaseShell( { group: this.skyline } );
		this.skyline = group;
		this.group.add( group );
		for ( const cell of this.resident.values() ) if ( ! cell.group.visible ) this.hitches.time( `cell ${cell.id} shown`, () => { cell.group.visible = true; } );

	}

	#drop( cell ) {

		this.removed?.( cell );
		for ( const id of cell.ids ) {

			this.buildings.delete( id );
			this.shellColliders.delete( id );

		}
		removeEntries( this.doors, new Set( cell.doors ) );
		removeEntries( this.entrances, new Set( cell.entrances ) );
		this.resident.delete( cell.id );
		releaseShell( cell );

	}

}

function removeEntries( array, entries ) {

	let write = 0;
	for ( const item of array ) if ( ! entries.has( item ) ) array[ write ++ ] = item;
	array.length = write;

}
