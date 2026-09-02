import { describe, expect, it } from 'vitest';
import { measure, sample } from './Polyline.js';

describe( '3D movement polylines', () => {

	it( 'measures and samples elevation as part of travel', () => {

		const line = measure( [ [ 0, 0, 0 ], [ 3, 4, 0 ], [ 3, 4, 12 ] ] );

		expect( line.length ).toBe( 17 );
		expect( line.mid ).toEqual( [ 3, 4, 3.5 ] );
		expect( sample( line, 2.5, 1 ) ).toMatchObject( { x: 1.5, y: 2, z: 0 } );
		expect( sample( line, 2.5, - 1 ) ).toMatchObject( { x: 3, y: 4, z: 9.5 } );

	} );

	it( 'reports slope in the direction of travel', () => {

		const line = measure( [ [ 0, 2, 0 ], [ 4, 5, 0 ] ] );

		expect( sample( line, 1, 1 ).pitch ).toBeCloseTo( Math.atan2( 3, 4 ) );
		expect( sample( line, 1, - 1 ).pitch ).toBeCloseTo( - Math.atan2( 3, 4 ) );

	} );

	it( 'fails closed on a missing or projected path', () => {

		expect( () => measure( undefined, 'lane L.path3' ) ).toThrow( /E_MOVEMENT_PATH3/ );
		expect( () => measure( [ [ 0, 0 ], [ 2, 0 ] ], 'lane L.path3' ) ).toThrow( /lane L\.path3\[0\]/ );

	} );

} );
