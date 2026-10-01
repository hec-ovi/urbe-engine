import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomFill } from './RoomFill.js';
import { luminance } from './Color.js';

const grey = ( level ) => new THREE.Color( level, level, level );

/** A 10 by 10 m room 3 m high: 200 m2 of floor and ceiling, 120 m2 of walls. */
const room = { area: 320, albedo: grey( 0.5 ), floorAlbedo: grey( 0.3 ) };
const white = grey( 1 );

describe( 'RoomFill', () => {

	it( 'carries the interreflected light alone when every fixture is drawn, the ceiling taking it off the floor', () => {

		const fill = RoomFill.perCopy( room, 3200, white );

		// 10 lux of flux per square metre, returned once over at p = 0.5.
		expect( fill.x ).toBeCloseTo( 10 );
		expect( fill.w ).toBeCloseTo( 0.3 );

	} );

	it( 'lands the undrawn downlights on the floor and half the walls, at the room\'s own flux', () => {

		const unseen = { down: 3200, up: 0, downColor: white, upColor: white };
		const fill = RoomFill.perCopy( room, 3200, white, unseen );

		// 3200 lm over the floor and half the walls, 160 m2.
		expect( fill.x ).toBeCloseTo( 10 + 20 );
		const ceiling = fill.x * fill.w;
		expect( ceiling ).toBeCloseTo( 3 );

		// The node gives a wall the mean of the two: what the floor and the
		// walls take of the direct light together is exactly what was undrawn.
		const direct = ( up, down ) => 100 * up + 100 * down + 120 * ( up + down ) / 2;
		expect( direct( fill.x, ceiling ) - direct( 10, 3 ) ).toBeCloseTo( 3200 );

	} );

	it( 'washes the ceiling over an undrawn cove, which can outshine the floor', () => {

		const warm = new THREE.Color( 1, 0.7, 0.4 );
		const fill = RoomFill.perCopy( room, 6400, white, { down: 0, up: 6400, downColor: white, upColor: warm } );

		expect( fill.w ).toBeGreaterThan( 1 );
		// 6400 lm over 160 m2 is 40 lux of the cove's colour on the ceiling.
		expect( fill.x * fill.w ).toBeCloseTo( 20 * 0.3 + 40 * luminance( warm ) );

	} );

	it( 'leaves a dark room dark', () => {

		const fill = RoomFill.perCopy( room, 0, white, { down: 0, up: 0 } );

		expect( fill.toArray() ).toEqual( [ 0, 0, 0, 0.3 ] );

	} );

} );
