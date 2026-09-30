import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from './Physics.js';
import { BODY_RADIUS, CROUCH_EYE_HEIGHT, EYE_HEIGHT, PlayerBody } from './PlayerBody.js';
import { ImpactWorld } from './ImpactWorld.js';

/**
 * Two promises the street depends on: a lamp post is solid, and the push that
 * gets the player out of a pedestrian is resolved against the world rather
 * than teleporting them through it.
 */
describe( 'PlayerBody against street furniture', () => {

	it( 'cannot walk through a lamp post, and a push resolves against it instead of through it', async () => {

		const { physics, body } = await world();
		physics.addPost( { x: 0, z: 2, base: 0, height: 6.4, radius: 0.14 } );

		for ( let step = 0; step < 120; step ++ ) {

			physics.step( 1 / 60 );
			body.move( new THREE.Vector3( 0, 0, 1.4 / 60 ), 1 / 60 );

		}

		// 120 steps of walking is 2.8 m, well past the post at z = 2
		expect( body.position.z ).toBeLessThan( 2 - 0.14 - BODY_RADIUS + 0.05 );

		physics.addPost( { x: 1, z: body.position.z, base: 0, height: 6.4, radius: 0.14 } );
		physics.step( 1 / 60 );
		const height = body.position.y;
		body.push( new THREE.Vector3( 3, 0, 0 ) );

		expect( body.position.y ).toBe( height );
		expect( body.position.x ).toBeLessThan( 1 - 0.14 - BODY_RADIUS + 0.05 );

	} );

	it( 'stands still while a pedestrian walks past at arm\'s length: their impact sensor is no obstacle and no floor', async () => {

		const { physics, body } = await world();
		const impacts = new ImpactWorld( physics );
		step( physics, body, 4 );
		const start = body.position.clone();
		// A walker going by beside the player, the crowd's own 0.66 m off their middle, at 1.2 m/s.
		const walker = { id: 'passer', position: new THREE.Vector3( - 3, 0, 0.66 ) };
		for ( let frame = 0; frame < 300; frame ++ ) {

			walker.position.x = - 3 + 1.2 * frame / 60;
			impacts.sync( { people: [ walker ], vehicles: [] } );
			step( physics, body );

		}

		expect( Math.hypot( body.position.x - start.x, body.position.z - start.z ) ).toBeLessThan( 1e-3 );

	} );

	it( 'jumps once from the floor, rises, and lands on the same floor', async () => {

		const { physics, body } = await world();
		step( physics, body, 2 );
		expect( body.grounded ).toBe( true );
		expect( body.jump() ).toBe( true );
		expect( body.jump() ).toBe( false );

		let top = body.feet.y;

		for ( let frame = 0; frame < 120; frame ++ ) {

			step( physics, body );
			top = Math.max( top, body.feet.y );

		}

		expect( top ).toBeGreaterThan( 0.9 );
		expect( body.feet.y ).toBeCloseTo( 0, 1 );
		expect( body.grounded ).toBe( true );

	} );

	it( 'crouches without moving its feet and stands again only with head clearance', async () => {

		const { physics, body } = await world();
		const floor = body.feet.y;

		expect( body.setCrouched( true ) ).toBe( true );
		expect( body.feet.y ).toBeCloseTo( floor );
		expect( body.eye.y - body.feet.y ).toBeCloseTo( CROUCH_EYE_HEIGHT );
		expect( body.setCrouched( false ) ).toBe( true );
		expect( body.eye.y - body.feet.y ).toBeCloseTo( EYE_HEIGHT );

		body.setCrouched( true );
		physics.addTrimesh( new THREE.BoxGeometry( 4, 0.2, 4 ).translate( 0, 1.36, 0 ) );
		physics.step( 1 / 60 );

		expect( body.canStand() ).toBe( false );
		expect( body.setCrouched( false ) ).toBe( false );
		expect( body.crouched ).toBe( true );
		expect( body.eye.y - body.feet.y ).toBeCloseTo( CROUCH_EYE_HEIGHT );

	} );

	it( 'holds still while the world holds, over the safety ground half space too', async () => {

		// Rapier lifts a character asked for a vanishing translation by half its
		// capsule whenever a half space is in the world: a held frame asks for none.
		const { physics, body } = await world();
		physics.addHalfSpace( - 14 );
		physics.refresh();
		const feet = body.feet.toArray();

		for ( let frame = 0; frame < 120; frame ++ ) {

			physics.step( 0 );
			body.push( new THREE.Vector3( 1e-6, 0, 0 ) );
			body.move( new THREE.Vector3(), 0 );

		}
		expect( body.feet.toArray() ).toEqual( feet );

		step( physics, body, 120 );
		expect( body.feet.y ).toBeCloseTo( 0.02, 3 );
		expect( body.grounded ).toBe( true );

	} );

	it( 'settles a spawn a little inside the pavement, or above it, onto its surface', async () => {

		const physics = await Physics.create();
		physics.addBoxes( [ { center: [ 0, 0.1, 0 ], halfExtents: [ 10, 0.1, 10 ] } ] );
		physics.addHalfSpace( - 14 );
		physics.refresh();

		for ( const start of [ 0.15, 0.2, 0.45 ] ) {

			const body = new PlayerBody( physics, new THREE.Vector3( 1, start, 2 ) );
			expect( body.settle() ).toBe( true );
			expect( body.feet.x ).toBe( 1 );
			expect( body.feet.y ).toBeCloseTo( 0.22 );
			expect( body.feet.z ).toBe( 2 );
			step( physics, body, 60 );
			expect( body.feet.y ).toBeCloseTo( 0.22, 3 );
			physics.world.removeCollider( body.collider, false );

		}
		// Nothing solid within a step: the spawn stays where it was put.
		const high = new PlayerBody( physics, new THREE.Vector3( 1, 3, 2 ) );
		expect( high.settle() ).toBe( false );
		expect( high.feet.y ).toBeCloseTo( 3 );

	} );

	it( 'leaves collision while carried and restores it at the published destination', async () => {

		const { body } = await world();
		body.beginCarry( new THREE.Vector3( 10, -12, 4 ) );
		expect( body.collider.isEnabled() ).toBe( false );
		expect( body.feet.toArray() ).toEqual( [ 10, -12, 4 ] );
		body.move( new THREE.Vector3( 10, 0, 0 ), 1 );
		expect( body.feet.toArray() ).toEqual( [ 10, -12, 4 ] );
		expect( body.teleport( new THREE.Vector3( 99, 99, 99 ) ) ).toBe( false );

		body.carryTo( new THREE.Vector3( 20, -12, 4 ) );
		body.endCarry( new THREE.Vector3( 30, 0, 8 ) );
		expect( body.collider.isEnabled() ).toBe( true );
		expect( body.feet.toArray() ).toEqual( [ 30, 0, 8 ] );

	} );

} );

/** A flat floor at y = 0 and a player standing on it at the origin. */
async function world() {

	const physics = await Physics.create();
	const floor = new THREE.PlaneGeometry( 40, 40 ).rotateX( - Math.PI / 2 );
	physics.addTrimesh( floor );

	return { physics, body: new PlayerBody( physics, new THREE.Vector3( 0, 0.02, 0 ) ) };

}

function step( physics, body, count = 1 ) {

	for ( let i = 0; i < count; i ++ ) {

		physics.step( 1 / 60 );
		body.move( new THREE.Vector3(), 1 / 60 );

	}

}
