import { describe, expect, it } from 'vitest';
import { kelvinColor } from './Kelvin.js';

/**
 * Warm against cold is what makes a dark frame readable, so the one promise
 * this has to keep is that a temperature comes back as a hue and nothing else:
 * the level always belongs to the fixture's flux.
 */
describe( 'kelvinColor', () => {

	it( 'gives a tungsten lamp more red than blue and a cold lamp the reverse', () => {

		const tungsten = kelvinColor( 2700 );
		const cold = kelvinColor( 6500 );

		expect( tungsten.r ).toBeGreaterThan( tungsten.b );
		expect( cold.b ).toBeGreaterThan( tungsten.b );
		expect( cold.r / cold.b ).toBeLessThan( tungsten.r / tungsten.b );

	} );

	it( 'carries hue only: the brightest channel is always full', () => {

		for ( const kelvin of [ 1800, 2700, 3500, 4000, 5000, 6500, 12000 ] ) {

			const color = kelvinColor( kelvin );

			expect( Math.max( color.r, color.g, color.b ) ).toBeCloseTo( 1, 5 );

		}

	} );

} );
