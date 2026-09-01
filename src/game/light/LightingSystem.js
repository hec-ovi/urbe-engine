import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { DynamicLighting } from 'three/addons/lighting/DynamicLighting.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

/**
 * Which lighting system the renderer runs, decided once after `renderer.init()`
 * because that is when the WebGPU-to-WebGL2 fallback has already happened.
 *
 * WebGPU gets Forward+ clustering: the frustum is binned on the GPU and a
 * fragment loops only over its own cluster, so hundreds of street fixtures cost
 * one compute dispatch instead of one BRDF evaluation each. The binning kernel
 * needs scatter writes, which the WebGL2 backend's transform-feedback compute
 * cannot express, so there the lights are batched into uniform arrays instead:
 * still linear per fragment, but a light appearing or leaving never recompiles
 * a material, which is what streaming a city needs.
 *
 * Neither system folds a batched or clustered light's id into its shader cache
 * key, so the whole city's fixtures can come and go for free. What does carry
 * ids is a per-material `lightsNode`, which is why room lighting is built from
 * a fixed pool (see RoomLights).
 */
export class LightingSystem {

	/** @returns { backend, capacity } */
	static install( renderer, tier ) {

		const webgpu = renderer.backend.isWebGPUBackend === true;

		renderer.lighting = webgpu
			? new ClusteredLighting( tier.clusteredLights, 32, 24, 64 )
			: new DynamicLighting( {
				maxPointLights: tier.batchedLights,
				maxSpotLights: 8,
				maxDirectionalLights: 2,
				maxHemisphereLights: 4
			} );

		if ( tier.roomStrips > 0 ) THREE.RectAreaLightNode.setLTC( RectAreaLightTexturesLib.init() );

		return {
			backend: webgpu ? 'webgpu' : 'webgl',
			capacity: webgpu ? tier.clusteredLights : tier.batchedLights
		};

	}

}
