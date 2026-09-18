import { byteHash, fail, freeze, hashValue, record } from './NativeStreetChecks.js';
import { checkStreetMetadata } from './NativeStreetMetadata.js';
import { retainedStreetGround } from './RetainedStreetGround.js';

const folder = path => path.slice( 0, path.lastIndexOf( '/' ) + 1 );

/** Opens only a complete source-bound bundle; scene decoding belongs to its consumer. */
export const openNativeStreetSource = options => StreetSource.open( options );

class StreetSource {
	#baseUrl;
	#fetch;
	#atlas;
	#manifest;
	#pieces;
	#pieceBase;
	#abort = new AbortController();
	static async open( options ) {
		const { reference, blueprint, baseUrl, sharedBase = '/out/shared', fetch: read = globalThis.fetch } = options ?? {};
		const shared = reference?.sharedKit;
		if ( ! record( reference ) || ! [ 4, 5 ].includes( Object.keys( reference ).length ) || reference.file !== 'streets/manifest.json'
			|| ! hashValue( reference.sha256 ) || ! hashValue( reference.kitSha256 ) || ! hashValue( reference.blueprintSha256 )
			|| ( Object.keys( reference ).length === 5 && ! /^[a-z-]+\/[0-9a-f]{16}$/.test( shared ?? '' ) )
			|| ! blueprint?.bytes || ! record( blueprint.data )
			|| typeof baseUrl !== 'string' || ! baseUrl || typeof read !== 'function' ) fail( 'Invalid street source options' );
		const source = new StreetSource( baseUrl.replace( /\/$/, '' ), read, blueprint.data );
		try {
			const hash = await byteHash( blueprint.bytes );
			if ( hash !== reference.blueprintSha256 ) fail( 'World blueprint byte hash mismatch' );
			const bytes = await source.#read( reference.file, reference.sha256 );
			const manifest = JSON.parse( new TextDecoder( 'utf-8', { fatal: true } ).decode( bytes ) );
			await checkStreetMetadata( manifest, blueprint, hash );
			source.#manifest = freeze( manifest );
			source.#pieces = new Map( manifest.kit.pieces.map( piece => [ piece.id, piece ] ) );
			// The street kit is the same bytes for every city of this design, so it
			// stands in the shared store and its pieces sit beside it there. A
			// world that carries its own copy keeps them where the manifest says.
			source.#pieceBase = shared ? `${sharedBase}/${shared}/` : folder( manifest.files.kit );
			return source;
		} catch ( error ) {
			source.dispose();
			if ( error.code === 'E_WORLD_STREETS' ) throw error;
			fail( `Could not open street bundle: ${error.message}`, error );
		}
	}
	get manifest() { return this.#manifest; }
	constructor( baseUrl, read, atlas ) {
		this.#baseUrl = baseUrl;
		this.#fetch = read;
		this.#atlas = atlas;
	}
	async #read( path, hash, signal ) {
		if ( this.#abort.signal.aborted ) fail( 'Street source is disposed' );
		try {
			const read = this.#fetch;
			const response = await read( path.startsWith( '/' ) ? path : `${this.#baseUrl}/${path}`, { signal: signal ? AbortSignal.any( [ this.#abort.signal, signal ] ) : this.#abort.signal } );
			if ( ! response.ok ) fail( `${path}: HTTP ${response.status}` );
			const bytes = await response.arrayBuffer();
			if ( hash && await byteHash( bytes ) !== hash ) fail( `${path}: byte hash mismatch` );
			if ( this.#abort.signal.aborted || signal?.aborted ) fail( 'Street read was cancelled' );
			return bytes;
		} catch ( error ) {
			if ( error.code === 'E_WORLD_STREETS' ) throw error;
			fail( `Could not read ${path}: ${error.message}`, error );
		}
	}
	async readPiece( id, signal ) {
		const piece = this.#pieces.get( id );
		if ( ! piece ) fail( `Unknown street piece: ${id}` );
		// The kit runtime checks the bytes against the size and hash the kit publishes.
		return this.#read( `${this.#pieceBase}${piece.file}`, null, signal );
	}
	retainedAtlas() { return retainedStreetGround( this.#atlas, this.#manifest ); }
	dispose() { this.#abort.abort(); }
}
