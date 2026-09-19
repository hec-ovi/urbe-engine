import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { NightFog } from './NightFog.js';
import { luminance } from '../light/Color.js';

/**
 * The medium indoors is the room's own light, not the sky's absence: a fogged
 * far wall settles on a radiance the room's fixtures account for, and thin
 * enough that a wall 10 m off is still mostly wall.
 */
describe( 'NightFog', () => {

	it( 'carries the room\'s radiance indoors at a density a room reads through', () => {

		const fog = new NightFog( new THREE.Scene(), { density: 0.0003, color: 0x8899aa } );
		const room = { color: new THREE.Color( 1, 0.8, 0.6 ), lux: 2 };

		fog.update( room, true, 1 );

		expect( fog.indoor ).toBe( 1 );
		// The air is the room's own walls seen through it, so it sits under
		// their radiance rather than over it: a surface under illuminance E
		// returns E p / ((1 - p) pi) once its bounces settle, and the medium is
		// taken at the dark end of interior reflectance.
		const surfaces = ( p ) => room.lux * p / ( ( 1 - p ) * Math.PI );
		expect( luminance( fog.color.value ) ).toBeCloseTo( 0.2, 6 );
		expect( luminance( fog.color.value ) ).toBeLessThan( surfaces( 0.4 ) );
		expect( fog.color.value.r ).toBeGreaterThan( fog.color.value.b );
		const share = 1 - Math.exp( - ( ( fog.base.value * 10 ) ** 2 ) );
		expect( share ).toBeGreaterThan( 0 );
		expect( share ).toBeLessThan( 0.2 );

		// Back on the street the air is the street's at once, the sky fading back in.
		fog.update( { color: new THREE.Color( 0, 1, 1 ), lux: 20 }, false, 0.3 );

		expect( fog.indoor ).toBeCloseTo( 0.5, 6 );
		expect( fog.color.value.g ).toBeCloseTo( fog.sky.g * 0.5, 6 );
		expect( fog.base.value ).toBeCloseTo( fog.indoorDensity * 0.5, 6 );

	} );

} );
