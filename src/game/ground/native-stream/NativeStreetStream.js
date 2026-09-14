import { Group } from 'three/webgpu';
import { NativePieceLoader, releaseNativePiece, streamError } from './NativePieceLoader.js';
import { nativeTriangles } from './NativeCollision.js';

/** Serial bounded residency over source-owned GLB cells. */
export class NativeStreetStream {
	constructor( source, materials ) {
		this.pieces = source.manifest.pieces;
		this.loader = new NativePieceLoader( source, materials );
		this.group = new Group(); this.group.name = 'native-streets';
		this.bounds = {
			min: [ Math.min( ...this.pieces.map( p => p.bounds.min[ 0 ] ) ), Math.min( ...this.pieces.map( p => p.bounds.min[ 2 ] ) ) ],
			max: [ Math.max( ...this.pieces.map( p => p.bounds.max[ 0 ] ) ), Math.max( ...this.pieces.map( p => p.bounds.max[ 2 ] ) ) ]
		};
		this.resident = new Map(); this.wanted = new Map();
		this.settings = { radius: 256 }; this.revision = 0;
		this.disposed = false; this.pending = null;
	}

	get stats() {
		return { indexed: this.pieces.length, resident: this.resident.size, wanted: this.wanted.size,
			collision: [ ...this.resident.values() ].filter( tile => tile.solid ).length, pending: Boolean( this.pending ) };
	}

	update( position, settings = {} ) {
		if ( this.disposed ) throw streamError( 'Street stream is disposed' );
		const next = { ...this.settings, ...settings }, collisionRadius = next.collisionRadius ?? next.radius;
		if ( ! Number.isFinite( position?.x ) || ! Number.isFinite( position?.z ) || ! Number.isFinite( next.radius ) || next.radius < 0
			|| ! Number.isFinite( collisionRadius ) || collisionRadius < 0 || collisionRadius > next.radius ) throw streamError( 'Invalid street window' );
		const x = Math.floor( position.x / 32 ), z = Math.floor( position.z / 32 );
		const key = `${x}:${z}:${next.radius}:${collisionRadius}`;
		if ( key !== this.key || next.prepare !== this.settings.prepare || next.collision !== this.settings.collision ) {
			this.settings = next; this.key = key; this.revision ++; this.error = null;
			this.wanted = new Map( this.pieces.map( piece => [ piece, distance( piece.bounds, ( x + 0.5 ) * 32, ( z + 0.5 ) * 32 ) ] )
				.filter( ( [ , d ] ) => d <= next.radius + 32 ).sort( ( a, b ) => a[ 1 ] - b[ 1 ] )
				.map( ( [ piece, d ] ) => [ piece.id, { piece, collide: piece.hasCollision && d <= collisionRadius + 32 } ] ) );
			if ( this.loading && ! this.wanted.has( this.loading.id ) ) this.loading.abort.abort();
			for ( const [ id, tile ] of this.resident ) {
				if ( ! this.wanted.has( id ) ) this.drop( id, tile );
				else if ( ! this.wanted.get( id ).collide || tile.collision !== next.collision ) this.dropCollision( id, tile );
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
			for ( const [ id, wanted ] of this.wanted ) {
				if ( this.disposed || revision !== this.revision ) break;
				let tile = this.resident.get( id );
				if ( ! tile ) {
					const abort = new AbortController(); this.loading = { id, abort };
					let group;
					try { group = await this.loader.load( wanted.piece, abort.signal ); }
					catch ( error ) { if ( abort.signal.aborted ) break; throw error; }
					finally { this.loading = null; }
					if ( this.disposed || ! this.wanted.has( id ) ) { releaseNativePiece( group ); continue; }
					tile = { group, collision: null, solid: false, prepared: null, busy: false };
					this.resident.set( id, tile );
				}
				tile.busy = true;
				try {
					const { prepare, collision } = this.settings;
						const current = () => ! this.disposed && this.resident.get( id ) === tile && this.wanted.has( id ) && prepare === this.settings.prepare;
					if ( prepare && tile.prepared !== prepare ) {
						await prepare( tile.group, { wanted: current } );
						if ( ! current() ) continue;
						tile.prepared = prepare;
					}
					if ( collision && this.wanted.get( id )?.collide && ! tile.solid ) {
						tile.collision = collision;
						tile.solid = await collision.addBand( `native-street:${id}`, nativeTriangles( tile.group ) );
						if ( ! current() || ! this.wanted.get( id )?.collide || collision !== this.settings.collision ) this.dropCollision( id, tile );
					}
					if ( current() ) this.group.add( tile.group );
				} catch ( error ) { this.drop( id, tile ); throw error; }
				finally { tile.busy = false; if ( this.resident.get( id ) !== tile ) releaseNativePiece( tile.group ); }
			}
			if ( revision === this.revision ) this.settled = revision;
		}
	}

	dropCollision( id, tile ) {
		tile.collision?.dropBand( `native-street:${id}` ); tile.collision = null; tile.solid = false;
	}
	drop( id, tile ) {
		this.dropCollision( id, tile ); this.resident.delete( id ); tile.group.removeFromParent();
		if ( ! tile.busy ) releaseNativePiece( tile.group );
	}
	dispose() {
		this.disposed = true; this.revision ++; this.wanted.clear(); this.loading?.abort.abort();
		for ( const [ id, tile ] of this.resident ) this.drop( id, tile );
		this.group.removeFromParent();
	}
}

function distance( bounds, x, z ) {
	return Math.hypot( Math.max( bounds.min[ 0 ] - x, 0, x - bounds.max[ 0 ] ), Math.max( bounds.min[ 2 ] - z, 0, z - bounds.max[ 2 ] ) );
}
