import { Group, Matrix4 } from 'three/webgpu';
import { frameYield } from '../../../app/FrameYield.js';
import { StreetPieces, streamError } from './StreetPieces.js';
import { StreetCells, placementBoxes, placementMatrix } from './StreetCells.js';

/** How long admission runs before it hands the display a frame. */
const SLICE_MS = 4;
const _world = new Matrix4();

/**
 * The saved street around the player, drawn from the shared piece kit.
 *
 * The kit loads once for the whole city and owns the batches, one per native
 * surface. A cell is then only a list of placements: admitting it appends their
 * matrices to batches that already stand, dropping it takes those copies back
 * out, and nothing decodes or uploads geometry again. Collision follows the
 * same list as one fixed cuboid body per cell.
 */
export class NativeStreetStream {

	constructor( source, materials ) {

		const { kit, placements } = source.manifest;
		this.cells = new StreetCells( kit, placements.placements );
		this.pieces = new StreetPieces( { kit, placements: placements.placements, source, materials } );
		this.placements = placements.placements.length;
		this.group = new Group();
		this.group.name = 'native-streets';
		this.group.add( this.pieces.group );
		this.bounds = this.cells.bounds;
		this.resident = new Map();
		this.wanted = new Map();
		this.settings = { radius: 256 };
		this.revision = 0;
		this.settled = null;
		this.key = null;
		this.error = null;
		this.disposed = false;
		this.pending = null;
		this.prepared = null;

	}

	get stats() {

		return { indexed: this.placements, resident: this.resident.size, wanted: this.wanted.size,
			collision: [ ...this.resident.values() ].filter( cell => cell.solid ).length, pending: Boolean( this.pending ) };

	}

	update( position, settings = {} ) {

		if ( this.disposed ) throw streamError( 'Street stream is disposed' );
		const next = { ...this.settings, ...settings }, collisionRadius = next.collisionRadius ?? next.radius;
		if ( ! Number.isFinite( position?.x ) || ! Number.isFinite( position?.z ) || ! Number.isFinite( next.radius ) || next.radius < 0
			|| ! Number.isFinite( collisionRadius ) || collisionRadius < 0 || collisionRadius > next.radius ) throw streamError( 'Invalid street window' );

		// Residency follows the player in 32 m steps, and every radius carries
		// that step, so walking across a cell never rebuilds the window.
		const x = ( Math.floor( position.x / 32 ) + 0.5 ) * 32, z = ( Math.floor( position.z / 32 ) + 0.5 ) * 32;
		const key = `${x}:${z}:${next.radius}:${collisionRadius}`;
		if ( key !== this.key || next.prepare !== this.settings.prepare || next.collision !== this.settings.collision ) {

			this.settings = next; this.key = key; this.revision ++; this.error = null;
			this.wanted = new Map( this.cells.near( x, z, next.radius + 32 )
				.map( ( [ cell, metres ] ) => [ cell.key, { cell, collide: metres <= collisionRadius + 32 } ] ) );
			for ( const [ id, cell ] of this.resident ) {

				if ( ! this.wanted.has( id ) ) this.drop( id, cell );
				else if ( ! this.wanted.get( id ).collide || cell.collision !== next.collision ) this.dropCollision( id, cell );

			}

		}
		if ( this.error ) return Promise.reject( this.error );
		if ( this.settled === this.revision ) return Promise.resolve();
		if ( ! this.pending ) this.pending = this.run().catch( error => { this.error = error; throw error; } ).finally( () => { this.pending = null; } );
		return this.pending;

	}

	async run() {

		while ( ! this.disposed && this.settled !== this.revision ) {

			const revision = this.revision;
			await this.pieces.ready;
			if ( this.disposed || revision !== this.revision ) continue;
			this.reserve();
			if ( ! await this.warm() ) continue;

			let deadline = performance.now() + SLICE_MS;
			for ( const [ id, wanted ] of this.wanted ) {

				if ( this.disposed || revision !== this.revision ) break;
				const cell = this.resident.get( id ) ?? this.admit( id, wanted.cell );
				const { collision } = this.settings;
				if ( collision && wanted.collide && ! cell.solid ) {

					cell.collision = collision;
					cell.solid = collision.addBoxes( `native-street:${id}`, this.boxes( wanted.cell ) );

				}
				if ( performance.now() >= deadline ) { await frameYield(); deadline = performance.now() + SLICE_MS; }

			}
			if ( revision === this.revision ) this.settled = revision;

		}

	}

	/**
	 * Room for every cell this window still wants, in one reallocation per
	 * batch and before anything compiles: a batch that grows afterwards is a
	 * batch the renderer has to build a pipeline for again.
	 */
	reserve() {

		const wanted = [];
		for ( const [ id, { cell } ] of this.wanted ) {

			if ( ! this.resident.has( id ) ) for ( const placement of cell.placements ) wanted.push( placement.piece );

		}
		this.pieces.reserve( wanted );

	}

	/**
	 * The batches are the city's, so nothing is admitted until the current
	 * preparation port has compiled them: one compile per surface, whatever
	 * pieces wear it.
	 */
	async warm() {

		const { prepare } = this.settings;
		if ( ! prepare || this.prepared === prepare ) return true;
		const current = () => ! this.disposed && prepare === this.settings.prepare;
		await prepare( this.pieces.group, { wanted: current } );
		if ( ! current() ) return false;
		this.prepared = prepare;
		return true;

	}

	/** Every placement of one cell, appended to the shared batches. */
	admit( id, cell ) {

		const handles = [];
		try {

			for ( const placement of cell.placements ) this.pieces.admit( placement, placementMatrix( placement, _world ), handles );

		} catch ( error ) {

			for ( const handle of handles ) this.pieces.release( handle );
			throw error;

		}
		const resident = { handles, collision: null, solid: false };
		this.resident.set( id, resident );
		return resident;

	}

	/** One cell's cuboids in world coordinates; markings and paint add none. */
	boxes( cell ) {

		const boxes = [];
		for ( const placement of cell.placements ) placementBoxes( placement, this.pieces.boxesOf( placement.piece ), boxes );
		return boxes;

	}

	dropCollision( id, cell ) {

		cell.collision?.dropBand( `native-street:${id}` ); cell.collision = null; cell.solid = false;

	}

	drop( id, cell ) {

		this.dropCollision( id, cell );
		this.resident.delete( id );
		for ( const handle of cell.handles ) this.pieces.release( handle );
		cell.handles = [];

	}

	dispose() {

		this.disposed = true; this.revision ++; this.wanted.clear();
		for ( const [ id, cell ] of this.resident ) this.drop( id, cell );
		this.pieces.dispose();
		this.group.removeFromParent();

	}

}
