import { ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture } from 'three/webgpu';
import { decodeNativeTexture } from './NativeTextureImage.js';

const WRAPS = { repeat: RepeatWrapping, clamp: ClampToEdgeWrapping };
const failure = message => Object.assign( new Error( message ), { code: 'E_STREET_TEXTURE' } );

/** Verified source maps shared by native materials for one loaded world. */
export class NativeTextureSource {
	constructor( options = {} ) {
		if ( ! options || typeof options !== 'object' || Array.isArray( options ) ) throw failure( 'Invalid native texture source options' );
		const { baseUrl = '/materials', fetch: fetchMap = globalThis.fetch, decode = decodeNativeTexture, prepareTexture = () => {}, anisotropy = 8 } = options;
		if ( typeof baseUrl !== 'string' || ! baseUrl || typeof fetchMap !== 'function' || typeof decode !== 'function' || typeof prepareTexture !== 'function'
			|| ! Number.isFinite( anisotropy ) || anisotropy < 1 || anisotropy > 16 ) throw failure( 'Invalid native texture source options' );
		Object.assign( this, { baseUrl: baseUrl.replace( /\/$/, '' ), fetch: fetchMap, decode, prepareTexture, anisotropy } );
		this.cache = new Map();
		this.abort = new AbortController();
		this.disposed = false;
	}

	load = ( id, path, definition ) => {
		if ( this.disposed ) throw failure( 'Native texture source is disposed' );
		if ( typeof id !== 'string' || ! id || typeof path !== 'string' || ! /^[a-zA-Z0-9._/-]+$/.test( path )
			|| path.split( '/' ).some( part => ! part || part === '.' || part === '..' ) || definition?.path !== `themes/${path}`
			|| ! /^[a-f0-9]{64}$/.test( definition.sha256 ) || ! Array.isArray( definition.resolution ) || definition.resolution.length !== 2
			|| ! definition.resolution.every( value => Number.isSafeInteger( value ) && value > 0 )
			|| ! [ 'srgb', 'linear' ].includes( definition.colorSpace ) || ! Array.isArray( definition.wrap ) || definition.wrap.length !== 2
			|| ! definition.wrap.every( value => Object.hasOwn( WRAPS, value ) ) ) throw failure( 'Invalid native texture reference' );
		const identity = JSON.stringify( [ path, definition.sha256, definition.resolution, definition.colorSpace, definition.wrap ] );
		const previous = this.cache.get( id );
		if ( previous ) {
			if ( previous.identity !== identity ) throw failure( `Conflicting street texture identity: ${id}` );
			return previous.resource;
		}
		const texture = new Texture();
		Object.assign( texture, {
			name: id, flipY: true, colorSpace: definition.colorSpace === 'srgb' ? SRGBColorSpace : NoColorSpace,
			wrapS: WRAPS[ definition.wrap[ 0 ] ], wrapT: WRAPS[ definition.wrap[ 1 ] ],
			minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter, anisotropy: this.anisotropy
		} );
		const ready = this.#read( id, path, structuredClone( definition ), texture );
		ready.catch( () => {} );
		texture[ Symbol.for( 'urbe.texture-ready' ) ] = ready;
		const resource = Object.freeze( { texture, ready } );
		this.cache.set( id, { identity, resource } );
		return resource;
	};

	async #read( id, path, definition, texture ) {
		try {
			const { fetch: fetchMap, decode, prepareTexture } = this;
			const response = await fetchMap( `${this.baseUrl}/${path}`, { signal: this.abort.signal } );
			if ( ! response.ok ) throw failure( `Street texture ${id}: HTTP ${response.status}` );
			const bytes = await response.arrayBuffer();
			const digest = await globalThis.crypto.subtle.digest( 'SHA-256', bytes );
			const hash = [ ...new Uint8Array( digest ) ].map( byte => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );
			if ( hash !== definition.sha256 ) throw failure( `Street texture hash mismatch: ${id}` );
			if ( this.disposed ) throw failure( 'Native texture source is disposed' );
			const image = await decode( bytes );
			if ( this.disposed ) { image.close?.(); throw failure( 'Native texture source is disposed' ); }
			if ( ( image.naturalWidth ?? image.width ) !== definition.resolution[ 0 ] || ( image.naturalHeight ?? image.height ) !== definition.resolution[ 1 ] ) {
				image.close?.(); throw failure( `Street texture dimensions disagree with catalog: ${id}` );
			}
			texture.image = image;
			await prepareTexture( texture );
			if ( image !== texture.image ) image.close?.();
			if ( this.disposed ) throw failure( 'Native texture source is disposed' );
			texture.needsUpdate = true;
		} catch ( error ) {
			texture.image?.close?.(); texture.image = null;
			if ( error?.code === 'E_STREET_TEXTURE' ) throw error;
			throw Object.assign( failure( `Street texture load failed: ${id}` ), { cause: error } );
		}
	}

	dispose() {
		if ( this.disposed ) return;
		this.disposed = true;
		this.abort.abort();
		for ( const { resource: { texture } } of this.cache.values() ) {
			texture.dispose(); texture.image?.close?.(); texture.image = null;
		}
		this.cache.clear();
	}
}
