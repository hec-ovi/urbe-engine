import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

/**
 * Builds the unified renderer for the requested backend, always with GPU
 * timestamp tracking on. WebGPU falls back to the WebGL2 backend on its own
 * when navigator.gpu is missing; actualBackend() reports what really runs.
 */
export class RendererFactory {

	static webgpuAvailable() {

		return WebGPU.isAvailable();

	}

	static async create( backend ) {

		const renderer = new THREE.WebGPURenderer( {
			antialias: true,
			trackTimestamp: true,
			forceWebGL: backend === 'webgl'
		} );
		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( window.innerWidth, window.innerHeight );
		await renderer.init();
		// GPU timing queries are free on WebGPU and a stall per pass on WebGL2, where the pool also overflows.
		renderer.trackTimestamp = RendererFactory.actualBackend( renderer ) === 'webgpu';
		return renderer;

	}

	static actualBackend( renderer ) {

		return renderer.backend.isWebGPUBackend === true ? 'webgpu' : 'webgl';

	}

}
