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

	it( 'opens a room back up to its own fixtures by day, and leaves the night alone', () => {

		const renderer = {};
		const exposure = new Exposure( renderer, 0.024 );
		exposure.setDaylight( - 8.5 );

		// Walked in out of the sun, the eye settles a stop and a half under the
		// night grade instead of at the street's full day exposure.
		exposure.enter( 'interior' );
		for ( let i = 0; i < 40; i ++ ) exposure.update( 0.25 );
		expect( exposure.stops ).toBe( - 1.5 );

		// Back out on the street it closes down to the day again.
		exposure.enter( 'exterior' );
		for ( let i = 0; i < 40; i ++ ) exposure.update( 0.25 );
		expect( exposure.stops ).toBe( - 8.5 );

		// At night a room and the street share one grade.
		exposure.setDaylight( 0 );
		exposure.enter( 'interior' );
		for ( let i = 0; i < 40; i ++ ) exposure.update( 0.25 );
		expect( exposure.stops ).toBe( 0 );

	} );

	it( 'keeps the street\'s probe at the street\'s grade in a room the eye has opened up to', () => {

		const renderer = {};
		const scene = { environmentIntensity: 1 };
		const exposure = new Exposure( renderer, 0.024 );
		exposure.environment = scene;
		exposure.setDaylight( - 8.5 );
		exposure.update( 0.1 );
		expect( scene.environmentIntensity ).toBe( 1 );

		// Seven stops opened up indoors, so the daylit city it reflects is turned
		// down by seven: on screen it reads exactly as it did on the street.
		exposure.enter( 'interior' );
		exposure.update( 0.3 );
		expect( scene.environmentIntensity * renderer.toneMappingExposure ).toBeCloseTo( 0.024 * 2 ** - 8.5, 12 );
		for ( let i = 0; i < 40; i ++ ) exposure.update( 0.25 );
		expect( scene.environmentIntensity ).toBeCloseTo( 2 ** - 7, 12 );

		// Put somewhere rather than walked there, the eye arrives adapted.
		// The volume is known a few frames after the cut, and the eye follows it at once.
		exposure.enter( 'exterior' );
		exposure.settle();
		exposure.update( 0.05 );
		expect( exposure.stops ).toBe( - 8.5 );
		exposure.enter( 'interior' );
		exposure.update( 0.05 );
		expect( exposure.stops ).toBe( - 1.5 );
		// Then it walks again.
		for ( let i = 0; i < 10; i ++ ) exposure.update( 0.05 );
		exposure.enter( 'exterior' );
		exposure.update( 0.06 );
		expect( exposure.stops ).toBeCloseTo( - 1.6, 9 );

		// The night's grade is the street's, and the probe keeps its weight.
		exposure.setDaylight( 0 );
		for ( let i = 0; i < 40; i ++ ) exposure.update( 0.25 );
		expect( scene.environmentIntensity ).toBe( 1 );

	} );

	it( 'grades a room its glass lights past a bright room\'s level at its own light, never below the street', () => {

		const renderer = {};
		const exposure = new Exposure( renderer, 0.024 );
		exposure.setDaylight( - 8.5 );

		// Less than the volume already takes off asks for nothing more.
		exposure.enter( 'interior', - 1 );
		exposure.settle();
		exposure.update( 0.05 );
		expect( exposure.stops ).toBe( - 1.5 );

		exposure.enter( 'interior', - 3 );
		exposure.update( 0.05 );
		expect( exposure.stops ).toBe( - 3 );

		exposure.enter( 'interior', - 12 );
		exposure.update( 0.05 );
		expect( exposure.stops ).toBe( - 8.5 );

	} );

} );
