import { describe, expect, it } from 'vitest';
import { groundAnchors } from './Anchors.js';

const npc = { anchors: [
	{ id: 'f0-a2', floor: 0, kind: 'seat', position: [ 5, 7 ], facingDeg: 90 },
	{ id: 'f0-a1', floor: 0, kind: 'work_spot', position: [ 1, 2 ], facingDeg: 0 },
	{ id: 'f1-a1', floor: 1, kind: 'seat', position: [ 3, 3 ], facingDeg: 0 },
	{ id: 'f0-a3', floor: 0, kind: 'toilet', position: [ 4, 4 ], facingDeg: 0 }
] };

describe( 'groundAnchors', () => {

	it( 'keeps the ground floor seats and work spots in world space, facing +x toward +z', () => {

		const anchors = groundAnchors( npc, 0.5 );

		expect( anchors.work.map( ( a ) => a.id ) ).toEqual( [ 'f0-a1' ] );
		expect( anchors.seat.map( ( a ) => a.id ) ).toEqual( [ 'f0-a2' ] );
		expect( anchors.work[ 0 ].position.toArray() ).toEqual( [ 1, 0.5, 2 ] );
		// facing +x is a heading of a quarter turn, facing +z is straight ahead
		expect( anchors.work[ 0 ].heading ).toBeCloseTo( Math.PI / 2 );
		expect( anchors.seat[ 0 ].heading ).toBeCloseTo( 0 );
		expect( groundAnchors( null, 0 ) ).toEqual( { work: [], seat: [] } );

	} );

} );
