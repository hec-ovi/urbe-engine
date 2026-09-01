import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from './Physics.js';
import { PlayerBody, BODY_RADIUS } from './PlayerBody.js';

/**
 * Two promises the street depends on: a lamp post is solid, and the push that
 * gets the player out of a pedestrian is resolved against the world rather
 * than teleporting them through it.
 */
describe( 'PlayerBody against street furniture', () => {

	it( 'cannot walk through a lamp post', async () => {

		const { physics, body } = await world();
		physics.addPost( { x: 0, z: 2, base: 0, height: 6.4, radius: 0.14 } );

		for ( let step = 0; step < 120; step ++ ) {

			physics.step( 1 / 60 );
			body.move( new THREE.Vector3( 0, 0, 1.4 / 60 ), 1 / 60 );

		}

		// 120 steps of walking is 2.8 m, well past the post at z = 2
		expect( body.position.z ).toBeLessThan( 2 - 0.14 - BODY_RADIUS + 0.05 );

	} );

	it( 'pushes out sideways without falling or passing through a post', async () => {

		const { physics, body } = await world();
		physics.addPost( { x: 1, z: 0, base: 0, height: 6.4, radius: 0.14 } );
		physics.step( 1 / 60 );

		const before = body.position.y;
		body.push( new THREE.Vector3( 3, 0, 0 ) );

		expect( body.position.y ).toBe( before );
		expect( body.position.x ).toBeLessThan( 1 - 0.14 - BODY_RADIUS + 0.05 );

	} );

	it( 'ignores a push of nothing', async () => {

		const { physics, body } = await world();
		physics.step( 1 / 60 );
		const before = body.position.clone();

		body.push( new THREE.Vector3( 0, 0, 0 ) );

		expect( body.position ).toEqual( before );

	} );

} );

/** A flat floor at y = 0 and a player standing on it at the origin. */
async function world() {

	const physics = await Physics.create();
	const floor = new THREE.PlaneGeometry( 40, 40 ).rotateX( - Math.PI / 2 );
	physics.addTrimesh( floor );

	return { physics, body: new PlayerBody( physics, new THREE.Vector3( 0, 0.02, 0 ) ) };

}
