import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomFill, albedoOf } from './RoomFill.js';

const white = () => new THREE.Color( 1, 1, 1 );

/**
 * The fill is the whole reason an interior reads as a photograph rather than a
 * 3D scene at night, and it is computed, not dialled. Two promises: the number
 * it computes is the radiosity one, and its colour comes back as the room's own
 * surfaces returning the fixture's light.
 */
describe( 'RoomFill', () => {

	// The research's worked room: 4 x 4 x 2.7 m, one 800 lm ceiling bulb,
	// reflectance 0.5. A = 2(16) + 4(10.8) = 75.2 m2.
	const room = {
		area: 75.2,
		albedo: new THREE.Color( 0.5, 0.5, 0.5 ),
		floorAlbedo: new THREE.Color( 0.3, 0.3, 0.3 )
	};

	it( 'lands the fill at the same order as the key light', () => {

		const fill = RoomFill.irradiance( room, 800, white() );
		const direct = 800 / ( 4 * Math.PI * 2.7 * 2.7 );

		expect( fill.r ).toBeCloseTo( 10.6, 1 );
		expect( fill.r / direct ).toBeGreaterThan( 0.5 );
		expect( fill.r / direct ).toBeLessThan( 2 );

	} );

	it( 'takes its colour from the fixtures and its floor side from the floor', () => {

		const light = new THREE.HemisphereLight();

		RoomFill.apply( light, room, 800, new THREE.Color( 1, 0.6, 0.3 ) );

		expect( light.intensity ).toBeGreaterThan( 0 );
		expect( light.color.r ).toBeGreaterThan( light.color.b );
		// The lower half is that light bounced off the floor once more.
		expect( light.groundColor.r ).toBeLessThan( light.color.r );

	} );

	it( 'goes dark in a room with no fixtures', () => {

		const light = new THREE.HemisphereLight( 0xffffff, 0xffffff, 5 );

		RoomFill.apply( light, room, 0, white() );

		expect( light.intensity ).toBe( 0 );

	} );

	it( 'reads a reflectance off the material kind in the middle of a key', () => {

		expect( albedoOf( 'cyberpunk/ceiling/mid' ) ).toBeGreaterThan( albedoOf( 'cyberpunk/carpet/mid' ) );
		expect( albedoOf( 'cyberpunk/nothing-like-this/mid' ) ).toBeGreaterThan( 0 );

	} );

} );
