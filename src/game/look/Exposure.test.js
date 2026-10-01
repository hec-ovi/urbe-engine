import { describe, expect, it } from 'vitest';
import { Exposure } from './Exposure.js';

describe( 'Exposure', () => {

	it( 'opens at the first hour it is lit at, then adapts to later hours and volumes over time', () => {

		const renderer = {};
		const exposure = new Exposure( renderer, 0.024 );
		expect( renderer.toneMappingExposure ).toBe( 0.024 );

		// A run opened by day starts at day's exposure, not adapted up from night.
		exposure.setDaylight( - 8.5 );
		expect( renderer.toneMappingExposure ).toBeCloseTo( 0.024 * 2 ** - 8.5, 10 );

		// Dusk afterwards moves the eye over time, as an hour passing does.
		exposure.setDaylight( - 4 );
		exposure.update( 0.3 );
		expect( exposure.stops ).toBeCloseTo( - 8, 6 );
		for ( let i = 0; i < 20; i ++ ) exposure.update( 0.3 );
		expect( exposure.stops ).toBe( - 4 );
		expect( renderer.toneMappingExposure ).toBeCloseTo( 0.024 * 2 ** - 4, 10 );

	} );

} );
