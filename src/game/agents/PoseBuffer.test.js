import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { PoseBuffer, halfFloats } from './PoseBuffer.js';

/**
 * On WebGL2 the pose rows are a half float texture, and the whole crowd is
 * posed from what this conversion writes: a value that lands wrong is a limb
 * somewhere else. Whichever conversion runs, every value has to read back
 * within half precision of the row that was baked.
 */
describe( 'PoseBuffer', () => {

	it( 'writes the rows as half floats the texture path reads back within half precision', () => {

		const data = new Float32Array( [ 0, 1, - 2.5, 0.333, 65504, - 0.0001, 3.14159, 1e-8 ] );
		const half = halfFloats( data );

		expect( half ).toBeInstanceOf( Uint16Array );
		for ( let i = 0; i < data.length; i ++ ) {

			const decoded = THREE.DataUtils.fromHalfFloat( half[ i ] );
			expect( Math.abs( decoded - data[ i ] ) ).toBeLessThanOrEqual( Math.abs( data[ i ] ) * 2 ** - 10 + 1e-7 );

		}

		const buffer = new PoseBuffer( data, 2, 1, false );

		expect( buffer.texture.image.width ).toBe( 2 );
		expect( buffer.texture.image.height ).toBe( 1 );
		expect( Array.from( buffer.texture.image.data ) ).toEqual( Array.from( half ) );

	} );

} );
