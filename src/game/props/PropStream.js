import { Group } from 'three/webgpu';
import { PropCells } from './PropCells.js';
import { PropBatches } from './PropBatches.js';
import { propTriangles } from './PropTriangles.js';

let serial = 0;

/** Placement ownership is permanent; instance and physics residency follow the player. */
export class PropStream {
	static validate( options ) {
		if ( ! options || typeof options !== 'object' || Array.isArray( options ) || Object.keys( options ).some( key => key !== 'cellSize' ) ) throw invalid( 'unsupported options' );
		if ( ! Number.isFinite( options.cellSize ?? 128 ) || ( options.cellSize ?? 128 ) < 1 ) throw invalid( 'cellSize must be at least one metre' );
	}
	constructor( { models, placements, counts }, options ) {
		Object.assign( this, { models, placements, counts } );
		this.group = new Group(); this.group.name = 'props';
		this.cells = new PropCells( placements, options.cellSize ?? 128 );
		this.batches = new PropBatches( models, this.group ); this.collisions = new Map();
		this.settings = { radius: 900, collisionRadius: 256, prepare: null, collision: null };
		this.id = `props:${serial ++}`; this.version = 0; this.completed = 0; this.pending = null; this.disposed = false;
		this.window = null;
	}
	get stats() {
		let collision = 0;
		for ( const record of this.collisions.values() ) if ( record.ready ) collision += record.count;
		return { indexed: this.placements.length, resident: this.batches.count, wanted: this.window?.placements.length ?? 0,
			collision, collisionCells: this.collisions.size, maxWorkMs: this.batches.maxWorkMs, draws: this.batches.draws, pending: Boolean( this.pending ) };
	}
	update( position, options = {} ) {
		if ( this.disposed ) return Promise.reject( invalid( 'stream is disposed' ) );
		try {
			validateWindow( position, options );
			const settings = { ...this.settings, ...options };
			const cell = `${Math.floor( position.x / this.cells.cellSize )}:${Math.floor( position.z / this.cells.cellSize )}`;
			const changed = ! this.window || cell !== this.window.cell || Object.keys( settings ).some( key => settings[ key ] !== this.settings[ key ] );
			if ( changed ) {
				this.settings = settings; this.version ++;
				const point = { x: position.x, z: position.z };
				this.window = { cell, placements: this.cells.items( this.cells.near( point, settings.radius ) ), collision: this.cells.near( point, settings.collisionRadius ) };
				this.#dropObsolete();
			}
			if ( ! this.pending && this.completed !== this.version ) {
				this.pending = Promise.resolve().then( () => this.#run() ).finally( () => { this.pending = null; } );
			}
			return this.pending ?? Promise.resolve();
		} catch ( error ) { return Promise.reject( error ); }
	}
	async #run() {
		while ( ! this.disposed && this.completed !== this.version ) {
			const version = this.version, window = this.window, { prepare, collision } = this.settings;
			const wanted = () => ! this.disposed && version === this.version;
			await this.batches.sync( window.placements, prepare, wanted );
			if ( ! wanted() ) continue;
			if ( collision ) for ( const [ key, cell ] of window.collision ) {
				if ( ! wanted() ) break;
				if ( this.collisions.has( key ) ) continue;
				const count = cell.items.filter( ( { item } ) => this.models.get( item.model ).collider ).length;
				if ( ! count ) continue;
				const record = { id: `${this.id}:${key}`, port: collision, count, ready: false };
				this.collisions.set( key, record );
				try {
					record.ready = await collision.addBand( record.id, propTriangles( cell.items, this.models ) );
					if ( ! record.ready && this.collisions.get( key ) === record ) this.collisions.delete( key );
				} catch ( error ) {
					collision.dropBand( record.id ); this.collisions.delete( key ); throw error;
				}
			}
			if ( wanted() ) this.completed = version;
		}
	}
	#dropObsolete() {
		for ( const [ key, record ] of this.collisions ) {
			if ( record.port !== this.settings.collision || ! this.window.collision.has( key ) ) { record.port.dropBand( record.id ); this.collisions.delete( key ); }
		}
	}
	dispose() {
		if ( this.disposed ) return;
		this.disposed = true; this.version ++;
		for ( const record of this.collisions.values() ) record.port.dropBand( record.id );
		this.collisions.clear(); this.batches.dispose(); this.group.clear(); this.cells.cells.clear(); this.placements = []; this.window = null;
		if ( this.pending ) this.pending.then( () => this.models.dispose(), () => this.models.dispose() );
		else this.models.dispose();
	}
}

function validateWindow( point, options ) {
	if ( ! Number.isFinite( point?.x ) || ! Number.isFinite( point?.z ) ) throw invalid( 'position must have finite x and z' );
	if ( ! options || typeof options !== 'object' || Array.isArray( options ) || Object.keys( options ).some( key => ! [ 'radius', 'collisionRadius', 'prepare', 'collision' ].includes( key ) ) ) throw invalid( 'unsupported window settings' );
	for ( const key of [ 'radius', 'collisionRadius' ] ) if ( key in options && ( ! Number.isFinite( options[ key ] ) || options[ key ] < 0 ) ) throw invalid( `${key} must be nonnegative` );
	if ( 'prepare' in options && options.prepare !== null && typeof options.prepare !== 'function' ) throw invalid( 'prepare must be a function' );
	if ( 'collision' in options && options.collision !== null && ( typeof options.collision?.addBand !== 'function' || typeof options.collision?.dropBand !== 'function' ) ) throw invalid( 'collision must expose addBand and dropBand' );
}
function invalid( message ) { return Object.assign( new Error( `E_PROP_STREAM: ${message}` ), { code: 'E_PROP_STREAM' } ); }
