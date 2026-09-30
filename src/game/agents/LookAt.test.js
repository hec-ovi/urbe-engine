import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { LOOK_LIMITS, LookAt } from './LookAt.js';

const DEGREE = Math.PI / 180;

/**
 * A spine, neck and head standing up from a root that faces +Z, their bones
 * turned in their rest pose as a real rig's are, so nothing works by a bone's
 * axes happening to be the world's.
 */
function person( heading = 0 ) {

	const root = new THREE.Group();
	root.rotation.y = heading;
	const bones = [ 'pelvis', 'spine_03', 'neck_01', 'Head' ].map( ( name ) => Object.assign( new THREE.Bone(), { name } ) );
	bones[ 0 ].position.y = 0.55;
	bones[ 1 ].position.y = 0.4;
	bones[ 2 ].position.y = 0.2;
	bones[ 3 ].position.y = 0.1;
	bones[ 1 ].quaternion.setFromEuler( new THREE.Euler( 0.3, 0.2, - 0.1 ) );
	bones[ 2 ].quaternion.setFromEuler( new THREE.Euler( - 0.2, - 0.4, 0.3 ) );
	bones[ 3 ].quaternion.setFromEuler( new THREE.Euler( 0.1, 0.5, 0.2 ) );
	root.add( bones[ 0 ] );
	for ( let i = 1; i < bones.length; i ++ ) bones[ i - 1 ].add( bones[ i ] );
	root.updateMatrixWorld( true );
	const pose = bones.map( ( bone ) => bone.quaternion.clone() );
	return { root, bones, pose };

}

/**
 * How far a joint's world orientation has turned from where the clip left it,
 * seen from the body facing `heading`: to its left about the up axis, and up.
 */
function turnOf( bone, before, heading = 0 ) {

	const now = bone.getWorldQuaternion( new THREE.Quaternion() );
	const facing = new THREE.Vector3( Math.sin( heading ), 0, Math.cos( heading ) );
	const forward = facing.clone().applyQuaternion( now.multiply( before.clone().invert() ) );
	const left = new THREE.Vector3( Math.cos( heading ), 0, - Math.sin( heading ) );
	return { yaw: Math.atan2( forward.dot( left ), forward.dot( facing ) ), pitch: Math.atan2( forward.y, Math.hypot( forward.dot( left ), forward.dot( facing ) ) ) };

}

/** Looks for `seconds` in frames the mixer would pose, handing the bones back to the clip before each. */
function look( gaze, { root, bones, pose }, point, seconds ) {

	for ( let t = 0; t < seconds; t += 1 / 60 ) {

		gaze.rest();
		bones.forEach( ( bone, i ) => bone.quaternion.copy( pose[ i ] ) );
		root.updateMatrixWorld( true );
		gaze.update( 1 / 60, point );

	}
	root.updateMatrixWorld( true );

}

describe( 'looking at the player', () => {

	it( 'turns a seated person\'s spine, neck and head round to somebody at their side, each within its limit', () => {

		const rig = person();
		const clipWorld = rig.bones.map( ( bone ) => bone.getWorldQuaternion( new THREE.Quaternion() ) );
		const gaze = new LookAt( rig.root );
		const head = rig.bones[ 3 ].getWorldPosition( new THREE.Vector3() );
		// Somebody 60 degrees to the person's left, at the height of their eye.
		const eye = head.clone().add( new THREE.Vector3( Math.sin( 60 * DEGREE ), 0, Math.cos( 60 * DEGREE ) ).multiplyScalar( 1.5 ) );
		look( gaze, rig, eye, 2 );

		const spine = turnOf( rig.bones[ 1 ], clipWorld[ 1 ] );
		const turned = turnOf( rig.bones[ 3 ], clipWorld[ 3 ] );
		expect( turned.yaw ).toBeCloseTo( 60 * DEGREE, 1 );
		expect( Math.abs( turned.pitch ) ).toBeLessThan( 3 * DEGREE );
		expect( spine.yaw ).toBeGreaterThan( 5 * DEGREE );
		expect( spine.yaw ).toBeLessThanOrEqual( LOOK_LIMITS.spine + 1e-6 );
		// The pelvis, which the chair holds, never turns.
		expect( rig.bones[ 0 ].quaternion.equals( rig.pose[ 0 ] ) ).toBe( true );

	} );

	it( 'follows the eye up and down, turns no further than the spine and head together, and leaves somebody behind them alone', () => {

		const rig = person( 1.1 );
		const clipWorld = rig.bones.map( ( bone ) => bone.getWorldQuaternion( new THREE.Quaternion() ) );
		const gaze = new LookAt( rig.root );
		const head = rig.bones[ 3 ].getWorldPosition( new THREE.Vector3() );
		const forward = new THREE.Vector3( Math.sin( 1.1 ), 0, Math.cos( 1.1 ) );
		// Standing in front of them, 40 cm above their eyes.
		look( gaze, rig, head.clone().addScaledVector( forward, 1.2 ).add( new THREE.Vector3( 0, 0.4, 0 ) ), 2 );
		const up = turnOf( rig.bones[ 3 ], clipWorld[ 3 ], 1.1 );
		expect( up.pitch ).toBeCloseTo( Math.min( LOOK_LIMITS.up, Math.atan2( 0.4, 1.2 ) ), 1 );
		expect( Math.abs( up.yaw ) ).toBeLessThan( 2 * DEGREE );

		// Far off to their right: as far round as they turn.
		const right = new THREE.Vector3( - Math.cos( 1.1 ), 0, Math.sin( 1.1 ) );
		look( gaze, rig, head.clone().addScaledVector( forward, 0.3 ).addScaledVector( right, 2 ), 3 );
		const round = turnOf( rig.bones[ 3 ], clipWorld[ 3 ], 1.1 );
		expect( round.yaw ).toBeLessThan( - 60 * DEGREE );
		expect( round.yaw ).toBeGreaterThanOrEqual( - ( LOOK_LIMITS.spine + LOOK_LIMITS.head ) - 1e-3 );

		// Behind them: they face their front again.
		look( gaze, rig, head.clone().addScaledVector( forward, - 2 ), 3 );
		expect( Math.abs( turnOf( rig.bones[ 3 ], clipWorld[ 3 ], 1.1 ).yaw ) ).toBeLessThan( 1 * DEGREE );

	} );

	it( 'eases in over about a third of a second, and back to the clip once there is nobody to look at', () => {

		const rig = person();
		const clipWorld = rig.bones.map( ( bone ) => bone.getWorldQuaternion( new THREE.Quaternion() ) );
		const gaze = new LookAt( rig.root );
		const head = rig.bones[ 3 ].getWorldPosition( new THREE.Vector3() );
		const eye = head.clone().add( new THREE.Vector3( 1.5, 0, 0.2 ) );
		look( gaze, rig, eye, 0.1 );
		const early = turnOf( rig.bones[ 3 ], clipWorld[ 3 ] ).yaw;
		look( gaze, rig, eye, 1.5 );
		const settled = turnOf( rig.bones[ 3 ], clipWorld[ 3 ] ).yaw;
		expect( early ).toBeGreaterThan( 0 );
		expect( early ).toBeLessThan( settled * 0.5 );
		look( gaze, rig, null, 2 );
		expect( gaze.weight ).toBe( 0 );
		rig.bones.forEach( ( bone, i ) => expect( bone.quaternion.angleTo( rig.pose[ i ] ) ).toBeLessThan( 1e-6 ) );

	} );

	it( 'hands the bones back to the clip before the mixer poses them', () => {

		const rig = person();
		const gaze = new LookAt( rig.root );
		gaze.update( 1, rig.bones[ 3 ].getWorldPosition( new THREE.Vector3() ).add( new THREE.Vector3( 2, 0, 0 ) ) );
		expect( rig.bones[ 3 ].quaternion.angleTo( rig.pose[ 3 ] ) ).toBeGreaterThan( 0.01 );
		gaze.rest();
		rig.bones.forEach( ( bone, i ) => expect( bone.quaternion.angleTo( rig.pose[ i ] ) ).toBeLessThan( 1e-6 ) );

	} );

} );
