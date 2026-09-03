import { describe, expect, it } from 'vitest';
import { sequentialTriangleIndices } from './Physics.js';

describe( 'trimesh index allocation', () => {

	it( 'builds one packed typed array with no boxed index list', () => {

		const indices = sequentialTriangleIndices( 12 );

		expect( indices ).toBeInstanceOf( Uint32Array );
		expect( [ ...indices ] ).toEqual( [ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 ] );
		expect( indices.byteLength ).toBe( 12 * Uint32Array.BYTES_PER_ELEMENT );

	} );

} );
