import * as THREE from 'three/webgpu';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

/**
 * Builds the unified renderer for the requested backend. WebGPU falls back to
 * the WebGL2 backend on its own when navigator.gpu is missing; actualBackend()
 * reports what really runs.
 *
 * GPU timestamps are decided before construction, because the backend copies
 * the flag then and never reads it again: on WebGPU the queries are free, on
 * WebGL2 each one is a pass that stalls the frame and a pool that overflows,
 * so a run that will land on WebGL2 never opens them.
 */
export class RendererFactory {

	static webgpuAvailable() {

		return WebGPU.isAvailable();

	}

	static async create( backend ) {

		const webgpu = backend !== 'webgl' && WebGPU.isAvailable();
		const renderer = new THREE.WebGPURenderer( {
			antialias: true,
			trackTimestamp: webgpu,
			forceWebGL: ! webgpu
		} );
		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( window.innerWidth, window.innerHeight );
		await renderer.init();
		return renderer;

	}

	static actualBackend( renderer ) {

		return renderer.backend.isWebGPUBackend === true ? 'webgpu' : 'webgl';

	}

}
