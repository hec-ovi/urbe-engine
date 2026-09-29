import * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

// What a decoded file hands over. Sampling (colour space, wrapping, repeats,
// anisotropy) belongs to whoever asked for the map, so none of it is copied.
const DECODED = [ 'isCompressedTexture', 'image', 'mipmaps', 'format', 'type', 'internalFormat', 'minFilter', 'magFilter', 'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment' ];

/**
 * Loads a map by its file: `.ktx2` through the Basis transcoder, anything else
 * as an image. Compressed maps upload without decoding at a quarter of the
 * memory, so a run that has a renderer prefers them once `detect` has run.
 */
export class TextureSource {

	constructor( { images = new THREE.TextureLoader(), ktx2 = new KTX2Loader().setTranscoderPath( '/basis/' ) } = {} ) {

		this.images = images;
		this.ktx2 = ktx2;
		this.compressed = false;

	}

	/** Reads the GPU's compressed formats; call once after `renderer.init()`. */
	detect( renderer ) {

		this.ktx2.detectSupport( renderer );
		if ( renderer?.backend?.isWebGLBackend === true ) dropEmulatedFormats( this.ktx2.workerConfig );
		countCompressedMemory( renderer?.info );
		this.compressed = true;
		return this;

	}

	/**
	 * Returns the texture at once and fills it when the file arrives, like
	 * TextureLoader. The caller holds this placeholder from now on (a plain
	 * texture with no image uploads as nothing, like an image still
	 * downloading); when a file decodes, its levels move in and the texture
	 * becomes compressed in place if that is what arrived.
	 *
	 * The catalog publishes the PNG as the master and the compressed sibling
	 * beside it, to be preferred where a run can take it and fallen back on
	 * where it cannot (../materials/CONTRACT.md). A GPU with no transcode
	 * target, a transcoder that will not start and a compressed file that will
	 * not decode all read the same from here, so the master is tried before the
	 * map is given up on: otherwise a surface whose PNG is perfectly good draws
	 * with no map at all.
	 *
	 * A copy of the placeholder (water clones its normal map to move it on its
	 * own) shares the image but not the levels, format or compression, which a
	 * compressed file keeps on the texture itself. A copy made before the file
	 * arrives is filled with the texture once the caller has fitted it, and one
	 * made after takes them at once, so it never uploads a bare size as pixels.
	 *
	 * @param map `{ image, ktx2 }` URLs, either of which may be absent
	 */
	load( { image, ktx2 }, onLoad, onError ) {

		const texture = new THREE.Texture();
		const waiting = new Set();
		let decoded = false;
		texture.clone = function () {

			const copy = THREE.Texture.prototype.clone.call( this );
			copy.clone = texture.clone;
			if ( decoded ) carry( texture, copy );
			else waiting.add( copy );
			return copy;

		};
		const adopt = ( loaded ) => {

			carry( loaded, texture );
			texture.needsUpdate = true;
			decoded = true;
			onLoad( texture );
			for ( const copy of waiting ) {

				carry( texture, copy );
				copy.needsUpdate = true;

			}
			waiting.clear();

		};
		const master = ( error ) => {

			if ( image ) this.images.load( image, adopt, undefined, onError );
			else onError( error );

		};

		const compressed = ( loaded ) => {

			if ( ! unalignedBlocks( loaded ) ) return adopt( loaded );
			loaded.dispose();
			master( new Error( `${ktx2} is not whole 4x4 blocks` ) );

		};

		if ( this.compressed && ktx2 ) this.ktx2.load( ktx2, compressed, undefined, master );
		else master( new Error( 'map publishes no image master' ) );

		return texture;

	}

	dispose() {

		this.ktx2.dispose();

	}

}

/** Moves what a decoded file hands over from one texture to another. */
function carry( from, to ) {

	for ( const key of DECODED ) if ( from[ key ] !== undefined ) to[ key ] = key === 'mipmaps' ? from.mipmaps.slice( 0 ) : from[ key ];

}

/**
 * WebGPURenderer asks its backend what compressed formats there are, and on
 * WebGL2 that is the extension list. Mesa's AMD and Intel drivers list ETC and
 * ASTC on desktop Linux and decompress them in the driver, on the main thread,
 * at every upload. three drops those for its WebGLRenderer but not for this
 * path; where the BC formats are there too, the maps transcode to those.
 */
function dropEmulatedFormats( config ) {

	const navigator = globalThis.navigator;
	if ( ! config || ! /Linux/.test( navigator?.platform ?? '' ) || /Android/.test( navigator?.userAgent ?? '' ) ) return;
	if ( ! ( config.astcSupported && config.etc2Supported && config.bptcSupported && config.dxtSupported ) ) return;
	config.astcSupported = config.etc1Supported = config.etc2Supported = false;

}

/**
 * A block-compressed texture's first level must be whole 4x4 blocks. WebGPU
 * refuses the texture and with it every command buffer that binds it, so the
 * whole frame is lost; WebGL2 refuses its storage and the surface draws black.
 * Such a map is unsupported here, so its PNG master draws instead.
 */
function unalignedBlocks( texture ) {

	if ( ! texture.isCompressedTexture || texture.format === THREE.RGBAFormat ) return false;
	const { width, height } = texture.image ?? {};
	return width % 4 !== 0 || height % 4 !== 0;

}

const COUNTED = Symbol.for( 'urbe.compressed-memory' );

/**
 * three's renderer counts every compressed texture as one byte, so a run on
 * compressed maps would report its texture memory as next to nothing. They
 * are counted at the bytes of their levels instead, which is what the GPU
 * holds (performance.json and the render-work notes read these numbers).
 */
function countCompressedMemory( info ) {

	const size = info?._getTextureMemorySize;
	if ( typeof size !== 'function' || info[ COUNTED ] ) return;
	info[ COUNTED ] = true;
	info._getTextureMemorySize = function ( texture ) {

		if ( ! texture?.isCompressedTexture || ! texture.mipmaps?.length ) return size.call( this, texture );
		let bytes = 0;
		for ( const level of texture.mipmaps ) bytes += level?.data?.byteLength ?? 0;
		return bytes || size.call( this, texture );

	};

}
