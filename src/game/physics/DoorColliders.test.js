import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from './Physics.js';
import { PlayerBody, BODY_RADIUS } from './PlayerBody.js';
import { DoorColliders } from './DoorColliders.js';

describe( 'moving exterior door collision', () => {

	it( 'blocks the player while closed and clears the published doorway when open', async () => {

		const physics = await Physics.create();
		physics.addTrimesh( new THREE.PlaneGeometry( 10, 10 ).rotateX( - Math.PI / 2 ) );
		const pivot = new THREE.Group();
		pivot.position.set( 0, 0, 0 );
		const leaf = {
			pivot,
			sign: 1,
			colliderGeometry: new THREE.BoxGeometry( 1, 2, 0.08 ).translate( 0.5, 1, 0 )
		};
		const door = { pivots: [ leaf ] };
		const colliders = new DoorColliders( physics, [ door ] );
		const body = new PlayerBody( physics, new THREE.Vector3( 0.5, 0.02, - 1 ) );

		walk( physics, body, 90 );
		expect( body.feet.z ).toBeLessThan( - BODY_RADIUS + 0.06 );

		body.teleport( new THREE.Vector3( 0.5, 0.02, - 1 ) );
		pivot.rotation.y = Math.PI / 2;
		colliders.sync( door );
		physics.step( 1 / 60 );
		walk( physics, body, 90 );

		expect( body.feet.z ).toBeGreaterThan( 0.5 );

	} );

} );

function walk( physics, body, frames ) {

	for ( let frame = 0; frame < frames; frame ++ ) {

		physics.step( 1 / 60 );
		body.move( new THREE.Vector3( 0, 0, 1.4 / 60 ), 1 / 60 );

	}

}
