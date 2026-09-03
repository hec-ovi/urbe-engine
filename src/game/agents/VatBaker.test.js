import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { normalWeldGroups, weldFrameNormals } from './VatBaker.js';

describe( 'VAT surface normals', () => {

	it( 'joins UV seam copies but preserves authored hard edges', () => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			1, 2, 3, 1, 2, 3, 1, 2, 3, 8, 9, 10
		], 3 ) );
		geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [
			0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0
		], 3 ) );

		const groups = normalWeldGroups( geometry );
		expect( groups ).toEqual( [ [ 0, 1 ] ] );

		const frame = new Float32Array( 4 + 4 * 4 );
		frame.set( [ 1, 0, 0 ], 4 );
		frame.set( [ 0, 2, 0 ], 8 );
		frame.set( [ 0, 0, 3 ], 12 );
		weldFrameNormals( frame, 4, groups );

		expect( Array.from( frame.slice( 4, 7 ) ) ).toEqual( [ 1, 2, 0 ] );
		expect( Array.from( frame.slice( 8, 11 ) ) ).toEqual( [ 1, 2, 0 ] );
		expect( Array.from( frame.slice( 12, 15 ) ) ).toEqual( [ 0, 0, 3 ] );

	} );

} );
