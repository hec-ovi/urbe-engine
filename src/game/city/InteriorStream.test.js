import { describe, expect, it } from 'vitest';
import { floorAt, materialKey, plain, variantOf } from './InteriorStream.js';
import { OUTSIDE_FLOORS } from './InteriorRooms.js';

/** Four floors of a real building: a basement, a tall lobby, two storeys. */
const bands = [
	{ floor: - 1, elevation: - 3.2, height: 3.2 },
	{ floor: 0, elevation: 0, height: 4 },
	{ floor: 1, elevation: 4, height: 3.4 },
	{ floor: 2, elevation: 7.4, height: 3.4 },
	{ floor: OUTSIDE_FLOORS, elevation: 0, height: 0 }
];

/**
 * Streaming a tower a floor at a time only works if the floor the player is on
 * is picked right: pick the wrong one and they fall through the slab they are
 * standing on, or the room they walked into is not in the scene.
 */
describe( 'floorAt', () => {

	it( 'is the floor whose slab-to-slab band holds the feet', () => {

		expect( floorAt( bands, 0.05 ) ).toBe( 0 );
		expect( floorAt( bands, 3.9 ) ).toBe( 0 );
		expect( floorAt( bands, 4.1 ) ).toBe( 1 );
		expect( floorAt( bands, 8 ) ).toBe( 2 );
		expect( floorAt( bands, - 1 ) ).toBe( - 1 );

	} );

	it( 'is the nearest floor from outside the building, which is where the player usually is', () => {

		// On the pavement, a few centimetres above the lobby slab.
		expect( floorAt( bands, 0.12 ) ).toBe( 0 );
		// On a roof terrace over the top floor.
		expect( floorAt( bands, 40 ) ).toBe( 2 );

	} );

	it( 'never answers with the band that belongs to no floor', () => {

		expect( floorAt( bands, 1000 ) ).not.toBe( OUTSIDE_FLOORS );

	} );

} );

/**
 * Two meshes of the same database entry and different variants are two looks
 * (a patterned ceiling and a plain one), so they must not share a bucket or the
 * second one silently wears the first one's material.
 */
describe( 'materialKey', () => {

	it( 'carries the variant the interior box asked for', () => {

		const key = materialKey( {
			name: 'cyberpunk/ceiling/high_rich',
			userData: { materialVariant: 'panel' }
		} );

		expect( key ).toBe( 'cyberpunk/ceiling/high_rich#panel' );
		expect( plain( key ) ).toBe( 'cyberpunk/ceiling/high_rich' );
		expect( variantOf( key ) ).toBe( 'panel' );

	} );

	it( 'is the plain key when no variant is named', () => {

		const key = materialKey( { name: 'cyberpunk/concrete/high_rich', userData: {} } );

		expect( key ).toBe( 'cyberpunk/concrete/high_rich' );
		expect( variantOf( key ) ).toBeUndefined();

	} );

} );
