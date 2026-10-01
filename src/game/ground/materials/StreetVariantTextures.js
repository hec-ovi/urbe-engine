import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, NoColorSpace, RGBAFormat, RepeatWrapping, SRGBColorSpace, UnsignedByteType } from 'three/webgpu';

const READY = Symbol.for( 'urbe.texture-ready' );

/**
 * The texture arrays a variant set draws from, a layer per variant: one sRGB
 * array of basecolor and one linear array packing normal X and Y, roughness
 * and AO ([VariantPack](VariantPack.js)). Two arrays per set whatever its
 * variant count, so a surface wearing variants binds two textures where it
 * bound four, and every one of its copies stays in its one batch.
 *
 * Each set downloads, checks and packs once, on a worker. Readiness rejects
 * only when the set's fallback variant cannot be read; another unreadable
 * variant draws as the fallback and is reported.
 */
export class StreetVariantTextures {

	/**
	 * @param baseUrl the public theme URL the catalog's `themes/` paths live under
	 * @param open makes the packing worker
	 */
	constructor( { baseUrl = '/materials', open = openWorker, anisotropy = 8 } = {} ) {

		this.baseUrl = baseUrl.replace( /\/$/, '' );
		this.open = open;
		this.anisotropy = anisotropy;
		this.cache = new Map();
		this.workers = new Set();
		this.disposed = false;

	}

	/** `{ color, response, ready }` for a set described by `StreetVariants`. */
	load = ( set ) => {

		if ( this.disposed ) throw new Error( 'Street variant textures are disposed' );
		if ( this.cache.has( set.id ) ) return this.cache.get( set.id );
		const [ width, height ] = set.resolution, depth = set.layers.length;
		const color = arrayTexture( `variants:${set.id}:color`, width, height, depth, SRGBColorSpace, this.anisotropy );
		const response = arrayTexture( `variants:${set.id}:response`, width, height, depth, NoColorSpace, this.anisotropy );
		const ready = this.#pack( set ).then( ( packed ) => {

			if ( this.disposed ) throw new Error( 'Street variant textures are disposed' );
			if ( packed.failed.length ) console.warn( `street variants ${set.id}: drawing the fallback for ${packed.failed.join( '; ' )}` );
			if ( packed.mismatched.length ) console.warn( `street variants ${set.id}: bytes differ from the catalog hash for ${packed.mismatched.join( ', ' )}, drawing the served maps` );
			color.image = { data: packed.color, width, height, depth };
			response.image = { data: packed.response, width, height, depth };
			color.needsUpdate = true;
			response.needsUpdate = true;

		} );
		ready.catch( () => {} );
		color[ READY ] = ready;
		response[ READY ] = ready;
		const resource = Object.freeze( { color, response, ready, resources: Object.freeze( [ { texture: color, ready }, { texture: response, ready } ] ) } );
		this.cache.set( set.id, resource );

		return resource;

	};

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		for ( const worker of this.workers ) worker.terminate();
		this.workers.clear();
		for ( const { color, response } of this.cache.values() ) {

			color.dispose();
			response.dispose();

		}
		this.cache.clear();

	}

	async #pack( set ) {

		const worker = this.open();
		if ( ! worker ) throw new Error( `street variants ${set.id}: no worker to pack them on` );
		this.workers.add( worker );
		const request = {
			width: set.resolution[ 0 ], height: set.resolution[ 1 ], fallback: set.fallback,
			layers: set.layers.map( ( layer ) => ( {
				id: layer.id,
				maps: Object.fromEntries( Object.entries( layer.maps ).map( ( [ slot, map ] ) => [ slot, { url: absolute( `${this.baseUrl}/${map.path.slice( 'themes/'.length )}` ), sha256: map.sha256 } ] ) )
			} ) )
		};
		try {

			const answer = await new Promise( ( resolve ) => {

				worker.onmessage = ( { data } ) => resolve( data );
				worker.onerror = ( event ) => {

					event.preventDefault?.();
					resolve( { error: event.message ?? 'the worker failed' } );

				};
				worker.postMessage( request );

			} );
			if ( answer.error ) throw new Error( `street variants ${set.id}: ${answer.error}` );
			return answer;

		} finally {

			worker.terminate();
			this.workers.delete( worker );

		}

	}

}

function arrayTexture( name, width, height, depth, colorSpace, anisotropy ) {

	const texture = new DataArrayTexture( null, width, height, depth );
	Object.assign( texture, {
		name, format: RGBAFormat, type: UnsignedByteType, colorSpace, flipY: false, generateMipmaps: true,
		wrapS: RepeatWrapping, wrapT: RepeatWrapping, magFilter: LinearFilter, minFilter: LinearMipmapLinearFilter, anisotropy
	} );

	return texture;

}

function absolute( url ) {

	return typeof location === 'undefined' ? url : new URL( url, location.href ).href;

}

function openWorker() {

	return typeof Worker === 'undefined' ? null : new Worker( new URL( './StreetVariants.worker.js', import.meta.url ), { type: 'module' } );

}
