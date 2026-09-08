import * as THREE from 'three/webgpu';
import { GroundTiles, fail } from './GroundTiles.js';
import { GroundMeshBuilder } from './GroundMeshBuilder.js';
import { groundTriangles } from './GroundTriangles.js';
import { GroundBatches } from './GroundBatches.js';

const yieldFrame = () => new Promise( resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame( resolve ) : setTimeout( resolve, 0 ) );

/** Serial tile admission with independent render and collision windows. */
export class GroundStream {

	constructor( atlas, factory, { cellSize = 128 } = {} ) {

		if ( ! Number.isFinite( cellSize ) || cellSize < 8 ) fail( 'cellSize must be at least 8 metres' );
		this.index = new GroundTiles( atlas, cellSize );
		this.factory = factory;
		this.bounds = this.index.bounds;
		this.group = new THREE.Group();
		this.group.name = 'ground';
		this.batches = new GroundBatches( this.group );
		this.geometries = new Map();
		this.resident = new Map();
		this.retiring = new Set();
		this.wanted = new Map();
		this.settings = { radius: 256 };
		this.revision = 0;
		this.pending = null;
		this.disposed = false;

	}

	get stats() {

		return { indexed: this.index.tiles.size, resident: this.resident.size, wanted: this.wanted.size,
			collision: [ ...this.resident.values() ].filter( tile => tile.solid ).length, pending: !! this.pending };

	}

	update( position, settings = {} ) {

		if ( this.disposed ) fail( 'Ground stream is disposed' );
		const next = { ...this.settings, ...settings };
		const collisionRadius = next.collisionRadius ?? next.radius;
		if ( ! Number.isFinite( position?.x ) || ! Number.isFinite( position?.z ) || ! Number.isFinite( next.radius ) || next.radius < 0
			|| ! Number.isFinite( collisionRadius ) || collisionRadius < 0 || collisionRadius > next.radius ) fail( 'Invalid ground window' );
		const step = this.index.cellSize / 4;
		const x = Math.floor( position.x / step ), z = Math.floor( position.z / step );
		const key = `${x}:${z}:${next.radius}:${collisionRadius}`;
		if ( key !== this.key || next.prepare !== this.settings.prepare || next.collision !== this.settings.collision ) {

			this.settings = next;
			this.key = key;
			this.error = null;
			this.revision ++;
			this.wanted = this.index.window( { x: ( x + 0.5 ) * step, z: ( z + 0.5 ) * step }, next.radius + step, collisionRadius + step );
			for ( const [ id, tile ] of this.resident ) {

				if ( ! this.wanted.has( id ) ) this.drop( id, tile );
				else if ( ! this.wanted.get( id ).collide || next.collision !== tile.collision ) this.dropCollision( id, tile );

			}

		}
		if ( this.error ) return Promise.reject( this.error );
		if ( this.settledRevision === this.revision ) return Promise.resolve();
		if ( ! this.pending ) this.pending = this.run().catch( error => {

			for ( const [ id, tile ] of this.resident ) if ( ! tile.visible ) this.drop( id, tile );
			this.error = error;
			throw error;

		} ).finally( () => { this.pending = null; if ( this.disposed ) this.batches.dispose(); } );
		return this.pending;

	}

	async run() {

		let completed = - 1;
		while ( ! this.disposed && completed !== this.revision ) {

			completed = this.revision;
			for ( const [ id, wanted ] of this.wanted ) {

				if ( this.disposed || completed !== this.revision ) break;
				let tile = this.resident.get( id );
				if ( ! tile ) {

					await yieldFrame();
					if ( this.disposed || completed !== this.revision ) break;
					const built = new GroundMeshBuilder( this.index.project( wanted.tile ), this.factory,
						{ ...this.index.context, moduleGeometries: this.geometries } ).build();
					tile = { group: built.group, visible: false, collision: null, solid: false, pending: false };
					tile.group.name = id;
					this.resident.set( id, tile );

				}
				try {

					tile.pending = true;
					const { collision } = this.settings;
					if ( this.resident.get( id ) !== tile || this.disposed ) continue;
					if ( collision && collision === this.settings.collision && this.wanted.get( id )?.collide && ! tile.solid ) {

						tile.collision = collision;
						tile.solid = await collision.addBand( id, groundTriangles( tile.group ) );
						if ( ! this.wanted.get( id )?.collide || collision !== this.settings.collision || this.disposed ) this.dropCollision( id, tile );

					}

				} catch ( error ) { this.drop( id, tile ); throw error; }
				finally { tile.pending = false; if ( this.retiring.has( tile ) ) this.release( tile ); }

			}
			if ( this.disposed || completed !== this.revision ) continue;
			const changed = this.batches.add( this.resident ), { prepare } = this.settings;
			this.needsPreparation ||= changed;
			if ( prepare && ( this.needsPreparation || this.prepared !== prepare ) ) {

				await prepare( this.group, { wanted: () => ! this.disposed && completed === this.revision } );
				if ( this.disposed || completed !== this.revision ) continue;
				this.prepared = prepare;

			}
			this.needsPreparation = false;
			this.batches.show();
			for ( const tile of this.resident.values() ) tile.visible = true;

		}
		this.settledRevision = this.revision;

	}

	dropCollision( id, tile ) {

		tile.collision?.dropBand( id );
		tile.collision = null;
		tile.solid = false;

	}

	drop( id, tile ) {

		this.dropCollision( id, tile );
		this.batches.drop( id );
		this.resident.delete( id );
		if ( tile.pending ) this.retiring.add( tile );
		else this.release( tile );

	}

	release( tile ) {

		this.retiring.delete( tile );
		tile.group.traverse( mesh => {

			if ( mesh.isInstancedMesh ) mesh.dispose();
			if ( mesh.geometry && ! mesh.userData.groundModule ) mesh.geometry.dispose();

		} );
		this.pruneGeometries();

	}

	pruneGeometries() {

		const used = new Set();
		for ( const tile of [ ...this.resident.values(), ...this.retiring ] ) tile.group.traverse( mesh => { if ( mesh.userData.groundModule ) used.add( mesh.geometry ); } );
		for ( const [ key, geometry ] of this.geometries ) if ( ! used.has( geometry ) ) { geometry.dispose(); this.geometries.delete( key ); }

	}

	dispose() {

		this.disposed = true;
		this.revision ++;
		this.wanted.clear();
		for ( const [ id, tile ] of this.resident ) this.drop( id, tile );
		this.pruneGeometries();
		if ( ! this.pending ) this.batches.dispose();
		this.group.removeFromParent();

	}

}
