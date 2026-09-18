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

		return url.endsWith( '.ktx2' )
			? this.ktx2.load( url, onLoad, undefined, onError )
			: this.images.load( url, onLoad, undefined, onError );

	}

	dispose() {

		this.ktx2.dispose();

	}

}
