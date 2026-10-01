import { describe, expect, it } from 'vitest';
import { standingPeaks } from './InteriorPeaks.js';

/** A placement table of so many copies of each module. */
function table( counts ) {

	return Object.entries( counts ).flatMap( ( [ module, count ] ) => Array.from( { length: count }, () => ( { module } ) ) );

}

/** A building whose floors are these tables, its footprint a 10 m square at x. */
function building( x, floors ) {

	return {
		floors: floors.map( ( placements, floor ) => ( { floor, placements, treatments: [] } ) ),
		bounds: { x0: x, x1: x + 10, z0: 0, z1: 10 },
		center: { x: x + 5, z: 5 }
	};

}

const keysOf = ( placement ) => ( placement.module === 'lift-car' ? [] : [ placement.module ] );
const support = ( placement ) => placement.module.startsWith( 'floor-' );
const rules = { keysOf, support, reach: 1, view: 36, drop: 95 };

describe( 'the most copies the interior draws stand at once', () => {

	it( 'takes a building\'s fullest run of floors around the player, and one more for a lift\'s destination', () => {

		const tower = building( 0, [
			table( { wall: 10, desk: 1 } ),
			table( { wall: 4, desk: 6 } ),
			table( { wall: 4, desk: 6, 'lift-car': 1 } ),
			table( { wall: 9, desk: 6 } ),
			table( { wall: 1, desk: 0 } )
		] );

		const peaks = standingPeaks( [ tower ], rules );

		// Walls are fullest standing on floor 1 (18 on floors 0 to 2), desks on floor 2 (18 on 1 to 3).
		expect( peaks.get( 'wall' ) ).toBe( 36 );
		expect( peaks.get( 'desk' ) ).toBe( 36 );
		// The lifts move their own cars and never stand in the shared draws.
		expect( peaks.has( 'lift-car' ) ).toBe( false );

	} );

	it( 'adds the buildings drawn together, and no building too far from the rest to be drawn with it', () => {

		const one = building( 0, [ table( { wall: 5 } ) ] );
		// 60 m apart: a player 30 m from each sees both.
		const near = building( 70, [ table( { wall: 7 } ) ] );
		// 80 m past that one: never drawn with either.
		const far = building( 160, [ table( { wall: 20 } ) ] );

		const peaks = standingPeaks( [ one, near, far ], rules );

		// The far one alone is the fullest neighbourhood: 20, and 20 more for its lift.
		expect( peaks.get( 'wall' ) ).toBe( 40 );
		expect( standingPeaks( [ one, near ], rules ).get( 'wall' ) ).toBe( 5 + 7 + 7 );
		expect( standingPeaks( [ one, far ], rules ).get( 'wall' ) ).toBe( 40 );

	} );

	it( 'adds the slabs that stand under floors not shown yet, from every building open around the player', () => {

		// 150 m apart: never drawn together, open together from between them.
		const a = building( 0, [ table( { 'floor-slab': 3, wall: 2 } ) ] );
		const b = building( 160, [ table( { 'floor-slab': 4, wall: 2 } ) ] );

		const peaks = standingPeaks( [ a, b ], rules );

		expect( peaks.get( 'wall' ) ).toBe( 4 );
		// Drawn: the fuller one twice over; standing as supports: both, and one more window.
		expect( peaks.get( 'floor-slab' ) ).toBe( 8 + 3 + 4 + 4 );

	} );

	it( 'counts a floor\'s own window returns beside the table its layout shares with the floors around it', () => {

		const shared = table( { wall: 2 } );
		const tower = building( 0, [ shared, shared, shared ] );
		tower.floors[ 1 ].treatments = table( { 'window-return': 5 } );
		tower.floors[ 2 ].treatments = table( { 'window-return': 1, wall: 1 } );

		const peaks = standingPeaks( [ tower ], rules );

		expect( peaks.get( 'wall' ) ).toBe( 2 * 7 );
		expect( peaks.get( 'window-return' ) ).toBe( 2 * 6 );

	} );

	it( 'counts one placement under every key a copy of it takes an instance in', () => {

		const tower = building( 0, [ table( { door: 2 } ) ] );
		const peaks = standingPeaks( [ tower ], { ...rules, keysOf: () => [ 'frame', 'leaf', 'leaf' ] } );

		expect( peaks.get( 'frame' ) ).toBe( 4 );
		expect( peaks.get( 'leaf' ) ).toBe( 8 );

	} );

} );
