import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomFill } from './RoomFill.js';
import { luminance } from './Color.js';

const grey = ( level ) => new THREE.Color( level, level, level );

/** A 10 by 10 m room 3 m high: 200 m2 of floor and ceiling, 120 m2 of walls. */
const room = { area: 320, albedo: grey( 0.5 ), floorAlbedo: grey( 0.3 ) };
const white = grey( 1 );

describe( 'RoomFill', () => {

	it( 'carries the interreflected light alone when every fixture is drawn, on the ceiling as on the floor', () => {

		const fill = RoomFill.perCopy( room, 3200, white );

		// 10 lux of flux per square metre, returned once over at p = 0.5.
		expect( fill.x ).toBeCloseTo( 10 );
		expect( fill.w ).toBeCloseTo( 1 );

	} );

	it( 'lands the undrawn downlights on the floor and half the walls, at the room\'s own flux', () => {

		const unseen = { down: 3200, up: 0, downColor: white, upColor: white };
		const fill = RoomFill.perCopy( room, 3200, white, unseen );

		// 3200 lm over the floor and half the walls, 160 m2.
		expect( fill.x ).toBeCloseTo( 10 + 20 );
		const ceiling = fill.x * fill.w;
		expect( ceiling ).toBeCloseTo( 10 );

		// The node gives a wall the mean of the two: what the floor and the
		// walls take of the direct light together is exactly what was undrawn.
		const direct = ( up, down ) => 100 * up + 100 * down + 120 * ( up + down ) / 2;
		expect( direct( fill.x, ceiling ) - direct( 10, 10 ) ).toBeCloseTo( 3200 );

	} );

	it( 'washes the ceiling over an undrawn cove, which can outshine the floor', () => {

		const warm = new THREE.Color( 1, 0.7, 0.4 );
		const fill = RoomFill.perCopy( room, 6400, white, { down: 0, up: 6400, downColor: white, upColor: warm } );

		expect( fill.w ).toBeGreaterThan( 1 );
		// 6400 lm over 160 m2 is 40 lux of the cove's colour on the ceiling.
		expect( fill.x * fill.w ).toBeCloseTo( 20 + 40 * luminance( warm ) );

	} );

	it( 'gives a ceiling over downlights the bounce a box of floor, walls and ceiling exchanging light settles at', () => {

		// A 10 by 10 m room 4.5 m high, 10000 lm of downlights landing four
		// fifths on the floor and the rest on the walls, solved by its view
		// factors: the ceiling's irradiance is the room's mean bounce within a
		// fifth, for a pale floor or a dark one under pale walls.
		const box = ( floor, walls, ceiling ) => {

			const area = [ 100, 100, 180 ];
			const fc = 0.42, fw = 1 - fc, wf = 100 * fw / 180, ww = 1 - 2 * wf;
			const view = [ [ 0, fc, fw ], [ fc, 0, fw ], [ wf, wf, ww ] ];
			const rho = [ floor, ceiling, walls ];
			const direct = [ 0.8 * 10000 / 100, 0, 0.2 * 10000 / 180 ];
			let exitance = [ 0, 0, 0 ];
			let lit = direct;
			for ( let i = 0; i < 200; i ++ ) {

				lit = direct.map( ( e, at ) => e + view[ at ].reduce( ( sum, f, from ) => sum + f * exitance[ from ], 0 ) );
				exitance = lit.map( ( e, at ) => rho[ at ] * e );

			}
			const mean = ( floor * 100 + ceiling * 100 + walls * 180 ) / 380;

			return { ceiling: lit[ 1 ], fill: RoomFill.perCopy( { area: 380, albedo: grey( mean ) }, 10000, white ) };

		};

		for ( const [ floor, walls, ceiling ] of [ [ 0.35, 0.5, 0.7 ], [ 0.15, 0.6, 0.02 ], [ 0.5, 0.3, 0.7 ] ] ) {

			const { ceiling: solved, fill } = box( floor, walls, ceiling );
			expect( Math.abs( fill.x * fill.w / solved - 1 ) ).toBeLessThan( 0.2 );

		}

	} );

	it( 'leaves a dark room dark', () => {

		const fill = RoomFill.perCopy( room, 0, white, { down: 0, up: 0 } );

		expect( fill.toArray() ).toEqual( [ 0, 0, 0, 1 ] );

	} );

} );
