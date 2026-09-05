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

	it( 'keeps translated paired leaves and capsule passage aligned at closed, half and full poses', async () => {

		const physics = await Physics.create();
		physics.addTrimesh( new THREE.PlaneGeometry( 20, 20 ).rotateX( - Math.PI / 2 ) );
		const frame = new THREE.Group();
		frame.position.set( 2, 0, 1 );
		frame.rotation.y = Math.PI / 4;
		const leaves = [ - 1, 1 ].map( sign => {
			const pivot = new THREE.Group();
			pivot.position.x = sign * 0.5;
			frame.add( pivot );
			return { pivot, sign, colliderGeometry: new THREE.BoxGeometry( 1, 2, 0.08 ).translate( 0, 1, 0 ) };
		} );
		const door = { pivots: leaves };
		const colliders = new DoorColliders( physics, [ door ] );
		const body = new PlayerBody( physics, frame.localToWorld( new THREE.Vector3( 0, 0.02, - 1 ) ) );
		const direction = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( frame.quaternion );
		const crossAt = x => {
			body.teleport( frame.localToWorld( new THREE.Vector3( x, 0.02, - 1 ) ) );
			walk( physics, body, 90, direction );
			return frame.worldToLocal( body.feet.clone() ).z;
		};
		const assertPose = () => {
			for ( const leaf of leaves ) {
				const position = leaf.pivot.getWorldPosition( new THREE.Vector3() );
				const rotation = leaf.pivot.getWorldQuaternion( new THREE.Quaternion() );
				const actual = leaf.collision.body.translation();
				expect( new THREE.Vector3( actual.x, actual.y, actual.z ).distanceTo( position ) ).toBeLessThan( 1e-6 );
				const actualRotation = leaf.collision.body.rotation();
				expect( Math.abs( rotation.dot( new THREE.Quaternion(
					actualRotation.x, actualRotation.y, actualRotation.z, actualRotation.w
				) ) ) ).toBeCloseTo( 1, 6 );
			}
		};
		assertPose();
		expect( crossAt( 0 ) ).toBeLessThan( - BODY_RADIUS + 0.06 );

		for ( const fraction of [ 0.5, 1 ] ) {
			for ( const leaf of leaves ) leaf.pivot.position.x = leaf.sign * ( 0.5 + fraction );
			colliders.sync( door );
			physics.step( 1 / 60 );
			assertPose();
			expect( crossAt( 0 ) ).toBeGreaterThan( 0.5 );
			if ( fraction === 0.5 ) expect( crossAt( 0.65 ) ).toBeLessThan( - BODY_RADIUS + 0.06 );
			else expect( crossAt( 0.65 ) ).toBeGreaterThan( 0.5 );
		}

	} );

} );

function walk( physics, body, frames, direction = new THREE.Vector3( 0, 0, 1 ) ) {

	for ( let frame = 0; frame < frames; frame ++ ) {

		physics.step( 1 / 60 );
		body.move( direction.clone().multiplyScalar( 1.4 / 60 ), 1 / 60 );

	}

}
