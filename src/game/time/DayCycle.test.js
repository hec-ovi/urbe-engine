import { describe, expect, it } from 'vitest';
import { dayCycle, stopsFor, SUN_LUX } from './DayCycle.js';

/**
 * Every part of the look reads this one function to decide whether it is dark,
 * so the thing it has to keep is that they cannot disagree: the lamps are on
 * exactly while the sun is down, and the exposure follows the same crossing.
 */
describe( 'dayCycle', () => {

	it( 'names the four states off the sun, not off the clock', () => {

		expect( dayCycle( 3 ).state ).toBe( 'night' );
		expect( dayCycle( 7.5 ).state ).toBe( 'dawn' );
		expect( dayCycle( 13 ).state ).toBe( 'day' );
		expect( dayCycle( 18.4 ).state ).toBe( 'dusk' );
		expect( dayCycle( 22 ).state ).toBe( 'night' );

	} );

	it( 'switches the lamps with the light, and never both on', () => {

		for ( const hour of [ 0, 4, 7.5, 8, 12, 17, 18.4, 21, 23 ] ) {

			const day = dayCycle( hour );

			expect( day.daylight + day.lampsOn ).toBeCloseTo( 1, 6 );

		}

		expect( dayCycle( 2 ).lampsOn ).toBe( 1 );
		expect( dayCycle( 13 ).lampsOn ).toBe( 0 );

	} );

	it( 'gives the sun its real illuminance and nothing at night', () => {

		expect( dayCycle( 13 ).sunLux ).toBeCloseTo( SUN_LUX, 0 );
		expect( dayCycle( 2 ).sunLux ).toBe( 0 );

	} );

	it( 'keeps the night at the exposure the whole look was graded at', () => {

		expect( stopsFor( 'night' ) ).toBe( 0 );
		// A sunlit street is about a thousand times a lamp-lit one.
		expect( stopsFor( 'day' ) ).toBeLessThan( stopsFor( 'dusk' ) );
		expect( stopsFor( 'dusk' ) ).toBeLessThan( stopsFor( 'night' ) );

	} );

} );
