import { describe, expect, it } from 'vitest';
import { WalkSurface } from './WalkSurface.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';

/** A street across x from 0 to 40: carriageway, gutter, kerb, pavement, then a block. */
function street() {

	const band = ( surface, z0, z1, top ) => ( { surface, polygon: [ [ 0, z0 ], [ 40, z0 ], [ 40, z1 ], [ 0, z1 ] ], bottom: - 0.2, ...( top === undefined ? {} : { top } ) } );
	return [
		band( 'roadway', 0, 6, 0 ), band( 'gutter', 6, 6.5, 0 ), band( 'curb', 6.5, 6.7, 0.2 ),
		band( 'sidewalk', 6.7, 10, 0.2 ), band( 'block', 10, 30, 0.2 )
	];

}

describe( 'WalkSurface', () => {

	it( 'reads the top of the Atlas cover under a point, pavement or carriageway', () => {

		const surface = new WalkSurface( street() );
		expect( surface.height( 20, 3 ) ).toBe( 0 );
		expect( surface.height( 20, 6.6 ) ).toBe( 0.2 );
		expect( surface.height( 20, 8 ) ).toBe( 0.2 );
		expect( surface.height( 5, 20 ) ).toBe( 0.2 );
		// Covers repeat across cells: a point far along the street reads the same.
		expect( surface.height( 39.5, 8 ) ).toBe( 0.2 );

	} );

	it( 'has no height off the street, and the pavement level its sidewalks publish', () => {

		const surface = new WalkSurface( street() );
		expect( surface.height( - 5, 8 ) ).toBeNull();
		expect( surface.height( 20, 40 ) ).toBeNull();
		expect( surface.paving ).toBe( 0.2 );

	} );

	it( 'stands on the highest of overlapping covers', () => {

		const surface = new WalkSurface( [ ...street(), { surface: 'open', polygon: [ [ 10, 2 ], [ 12, 2 ], [ 12, 4 ], [ 10, 4 ] ], top: 0.5 } ] );
		expect( surface.height( 11, 3 ) ).toBe( 0.5 );
		expect( surface.height( 13, 3 ) ).toBe( 0 );

	} );

	it( 'takes the retained ground level for a cover without a top, and skips what nobody walks on', () => {

		const surface = new WalkSurface( [
			{ surface: 'sidewalk', polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] },
			{ surface: 'roadway', polygon: [ [ 4, 0 ], [ 8, 0 ], [ 8, 4 ], [ 4, 4 ] ] },
			{ surface: 'water', polygon: [ [ 8, 0 ], [ 12, 0 ], [ 12, 4 ], [ 8, 4 ] ], top: - 1 }
		] );
		expect( surface.height( 2, 2 ) ).toBe( SIDEWALK_HEIGHT );
		expect( surface.height( 6, 2 ) ).toBe( 0 );
		expect( surface.height( 10, 2 ) ).toBeNull();
		expect( new WalkSurface().paving ).toBe( SIDEWALK_HEIGHT );

	} );

} );
