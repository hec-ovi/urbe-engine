import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from './Physics.js';
import { BODY_RADIUS, PlayerBody } from './PlayerBody.js';
import { FALL_DROP, FallGuard } from './FallGuard.js';

/**
 * The guard against real Rapier: a street slab ending at x = 0 with nothing
 * past it but the safety floor 14 m down, as the ground under a building with
 * no floor was, and the player walking off its end.
 */
const FLOOR = - 14;

describe( 'FallGuard', () => {

	it( 'puts a player who walks into a hole back where they last stood on the street, long before the safety floor', async () => {

		const { physics, body, guard } = await street();
		const back = walk( physics, body, guard, 1.4, 600 );

		expect( back ).not.toBeNull();
		// The last street point stands on the slab, at its top, at most the
		// body's radius past its end, where the capsule still rests on the edge.
		expect( back.point.x ).toBeLessThan( BODY_RADIUS + 0.05 );
		expect( back.point.x ).toBeGreaterThan( - 2 );
		expect( Math.abs( back.point.y ) ).toBeLessThan( BODY_RADIUS );
		// It answered once the feet were a few metres under the street, nowhere near the safety floor.
		expect( back.feet.y ).toBeLessThan( - FALL_DROP );
		expect( back.feet.y ).toBeGreaterThan( - FALL_DROP - 1 );
		physics.world.free();

	} );

	it( 'lets a fall onto solid ground run its course, and keeps where it lands', async () => {

		const { physics, body, guard } = await street();
		// A roof 10 m over the street, its edge at x = -5.
		physics.addBoxes( [ { center: [ - 7, 9.75, 0 ], halfExtents: [ 2, 0.25, 4 ], rotationY: 0 } ] );
		physics.refresh();
		body.teleport( { x: - 8, y: 10.02, z: 0 } );
		guard.placed( - 8, 10.02, 0 );
		const fell = walk( physics, body, guard, 1.4, 240 );

		expect( fell ).toBeNull();
		expect( body.grounded ).toBe( true );
		expect( body.feet.y ).toBeCloseTo( 0, 1 );
		expect( guard.safe.y ).toBeCloseTo( 0, 1 );
		expect( guard.safe.x ).toBeGreaterThan( - 5 );
		physics.world.free();

	} );

	it( 'puts a player found on the safety floor back at once', async () => {

		const { physics, body, guard } = await street();
		settle( physics, body, guard, 10 );
		body.teleport( { x: 3, y: FLOOR + 0.02, z: 0 } );
		settle( physics, body, guard, 2, false );

		expect( guard.update() ).toMatchObject( { x: expect.closeTo( - 3, 3 ), y: expect.closeTo( 0, 1 ), z: expect.closeTo( 0, 3 ) } );
		physics.world.free();

	} );

	it( 'keeps the street point while the player stands indoors', async () => {

		const { physics, body, guard } = await street();
		settle( physics, body, guard, 10 );
		body.teleport( { x: - 6, y: 0.02, z: 2 } );
		settle( physics, body, guard, 10, true, false );

		expect( guard.safe.toArray() ).toEqual( [ expect.closeTo( - 3, 3 ), expect.closeTo( 0, 1 ), expect.closeTo( 0, 3 ) ] );
		physics.world.free();

	} );

	it( 'takes the point a ride puts the player down at as one to come back to', async () => {

		const { physics, body, guard } = await street();
		settle( physics, body, guard, 10 );
		body.beginCarry( new THREE.Vector3( - 6, 0.02, 3 ) );
		// Riding is not falling, however far down the ride goes.
		body.carryTo( new THREE.Vector3( - 6, - 30, 3 ) );
		expect( guard.update() ).toBeNull();
		body.endCarry( new THREE.Vector3( - 8, 0.02, - 3 ) );
		expect( guard.update() ).toBeNull();

		expect( guard.safe.toArray() ).toEqual( [ - 8, expect.closeTo( 0.02, 6 ), - 3 ] );
		physics.world.free();

	} );

} );

/** The street slab, the safety floor and the player standing at x = -3 on it. */
async function street() {

	const physics = await Physics.create();
	physics.addBoxes( [ { center: [ - 10, - 0.25, 0 ], halfExtents: [ 10, 0.25, 6 ], rotationY: 0 } ] );
	physics.addHalfSpace( FLOOR );
	physics.refresh();
	const body = new PlayerBody( physics, new THREE.Vector3( - 3, 0.02, 0 ) );
	const guard = new FallGuard( { physics, body, floor: FLOOR } );

	return { physics, body, guard };

}

/** Steps the world with the body standing still; the guard watches each step. */
function settle( physics, body, guard, steps, watched = true, street = true ) {

	for ( let i = 0; i < steps; i ++ ) {

		physics.step( 1 / 60 );
		body.move( new THREE.Vector3(), 1 / 60 );
		if ( watched ) guard.update( street );

	}

}

/** Walks +X at `speed` until the guard answers: the point it answered and where the feet were, or null. */
function walk( physics, body, guard, speed, steps ) {

	for ( let i = 0; i < steps; i ++ ) {

		physics.step( 1 / 60 );
		body.move( new THREE.Vector3( speed / 60, 0, 0 ), 1 / 60 );
		const back = guard.update();
		if ( back ) return { point: back.clone(), feet: body.feet };

	}

	return null;

}
