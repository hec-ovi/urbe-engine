import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NightLook } from './NightLook.js';

/** What a renderer is to the look before its first frame, on the backend named. */
function renderer( webgpu = false ) {

	let ratio = 1;
	return {
		backend: { isWebGPUBackend: webgpu },
		lighting: new THREE.Lighting(),
		getPixelRatio: () => ratio,
		setPixelRatio: ( value ) => { ratio = value; }
	};

}

const originalRatio = globalThis.devicePixelRatio;
afterEach( () => { globalThis.devicePixelRatio = originalRatio; } );

describe( 'the night look on a renderer', () => {

	it( 'renders at most the tier\'s pixel ratio', () => {

		for ( const [ quality, device, expected ] of [ [ 'medium', 2, 1 ], [ 'high', 2, 1.5 ], [ 'ultra', 3, 2 ], [ 'high', 1, 1 ] ] ) {

			globalThis.devicePixelRatio = device;
			const target = renderer();
			NightLook.begin( target, { quality, backend: 'webgl' } );
			expect( target.getPixelRatio() ).toBe( expected );

		}

	} );

} );
