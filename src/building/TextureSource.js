import * as THREE from 'three/webgpu';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

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

	/** The compressed path when this run can use it, else the image path. */
	choose( { image, ktx2 } ) {

		return this.compressed && ktx2 ? ktx2 : image;

	}

	/** Returns the texture at once and fills it when the file arrives, like TextureLoader. */
	load( url, onLoad, onError ) {

		if ( ! url.endsWith( '.ktx2' ) ) return this.images.load( url, onLoad, undefined, onError );

		// The caller holds this placeholder from now on (a plain texture with no
		// image uploads as nothing, like an image still downloading); when the
		// transcoder answers, its decoded levels move in and the texture becomes
		// compressed in place.
		const texture = new THREE.Texture();
		this.ktx2.load( url, ( loaded ) => {

			for ( const key of [ 'isCompressedTexture', 'image', 'mipmaps', 'format', 'type', 'internalFormat', 'minFilter', 'magFilter', 'generateMipmaps', 'premultiplyAlpha', 'unpackAlignment' ] ) {

				if ( loaded[ key ] !== undefined ) texture[ key ] = loaded[ key ];

			}
			texture.flipY = false;
			texture.needsUpdate = true;
			onLoad( texture );

		}, undefined, onError );
		return texture;

	}

	dispose() {

		this.ktx2.dispose();

	}

}
