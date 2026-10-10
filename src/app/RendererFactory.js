import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { skipEmptyDraws } from './EmptyDraws.js';
import { installStaticTextureNodes } from './StaticTextureNodes.js';
import { LightingSystem } from '../game/light/LightingSystem.js';

/**
 * Builds the unified renderer for the requested backend. WebGPU falls back to
 * the WebGL2 backend on its own when navigator.gpu is missing; actualBackend()
 * reports what really runs.
 *
 * GPU timestamps are decided before construction, because the backend copies
 * the flag then and never reads it again: on WebGPU the queries are free, on
 * WebGL2 each one is a pass that stalls the frame and a pool that overflows,
 * so a run that will land on WebGL2 never opens them.
 *
 * Objects with nothing to draw in a pass are left out of it before three
 * refreshes their nodes and bindings ([EmptyDraws.js](EmptyDraws.js)), and a
 * texture that can never be flipped keeps no per-draw update on WebGL2
 * ([StaticTextureNodes.js](StaticTextureNodes.js)), installed before the
 * first material is built.
 */
export class RendererFactory {

	static webgpuAvailable() {

		return WebGPU.isAvailable();

	}

	/**
	 * @param antialias whether the canvas itself is multisampled: a path that
	 * composes its frame through the look pipeline samples its scene pass by
	 * tier instead and asks for none here
	 */
	static async create( backend, { antialias = true } = {} ) {

		installStaticTextureNodes();
		const webgpu = backend !== 'webgl' && WebGPU.isAvailable();
		const renderer = await RendererFactory.#open( webgpu, antialias );
		skipEmptyDraws( renderer );
		return renderer;

	}

	/**
	 * Opens the renderer. `navigator.gpu` can exist while no adapter is free
	 * (the talk model holds the GPU, or the browser has none). Three throws
	 * then and the city never draws, so the same run opens again on WebGL.
	 */
	static async #open( webgpu, antialias ) {

		const renderer = new THREE.WebGPURenderer( {
			antialias,
			trackTimestamp: webgpu,
			forceWebGL: ! webgpu
		} );
		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( window.innerWidth, window.innerHeight );
		// The render lists init builds hold the lighting the renderer has now.
		LightingSystem.prepare( renderer );
		try {

			await renderer.init();
			return renderer;

		} catch ( error ) {

			try { renderer.dispose(); } catch { /* init failed before a device */ }
			if ( ! webgpu ) throw error;
			console.warn( 'WebGPU has no adapter; drawing with WebGL instead.', error instanceof Error ? error.message : error );
			return RendererFactory.#open( false, antialias );

		}

	}

	static actualBackend( renderer ) {

		return renderer.backend.isWebGPUBackend === true ? 'webgpu' : 'webgl';

	}

}
