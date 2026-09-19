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
	 * @param map `{ image, ktx2 }` URLs, either of which may be absent
	 */
	load( { image, ktx2 }, onLoad, onError ) {

		const texture = new THREE.Texture();
		const adopt = ( loaded ) => {

			for ( const key of DECODED ) if ( loaded[ key ] !== undefined ) texture[ key ] = loaded[ key ];
			texture.needsUpdate = true;
			onLoad( texture );

		};
		const master = ( error ) => {

			if ( image ) this.images.load( image, adopt, undefined, onError );
			else onError( error );

		};

		if ( this.compressed && ktx2 ) this.ktx2.load( ktx2, adopt, undefined, master );
		else master( new Error( 'map publishes no image master' ) );

		return texture;

	}

	dispose() {

		this.ktx2.dispose();

	}

}
