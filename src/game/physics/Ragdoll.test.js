import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics, Ragdoll, RagdollError } from './index.js';

describe( 'articulated character physics', () => {

	it( 'interrupts the installed rig pose into joined Rapier bodies that fall onto world collision', async () => {

		const physics = await Physics.create();
		physics.addTrimesh( new THREE.BoxGeometry( 20, 0.1, 20 ).translate( 0, - 0.05, 0 ) );
		const root = sourceRig();
		const head = root.getObjectByName( 'Head' );
		const before = head.getWorldPosition( new THREE.Vector3() );
		const ragdoll = Ragdoll.create( {
			physics,
			root,
			impact: {
				point: { x: before.x, y: before.y, z: before.z },
				impulse: { x: 24, y: 3, z: 0 }
			}
		} );

		expect( ragdoll.summary ).toEqual( { bodies: 15, joints: 14, totalMassKg: 70 } );

		for ( let step = 0; step < 90; step ++ ) {

			physics.step( 1 / 60 );
			ragdoll.update( 1 / 60 );

		}

		const after = head.getWorldPosition( new THREE.Vector3() );
		expect( after.x ).toBeGreaterThan( before.x + 0.08 );
		expect( after.y ).toBeLessThan( before.y );
		const driven = requiredBones( root ).map( ( bone ) => bone.getWorldPosition( new THREE.Vector3() ) );
		expect( driven.every( ( point ) => [ point.x, point.y, point.z ].every( Number.isFinite ) ) ).toBe( true );
		expect( Math.min( ...driven.map( ( point ) => point.y ) ) ).toBeGreaterThan( - 0.2 );

		ragdoll.dispose();
		ragdoll.dispose();
		expect( () => ragdoll.update( 0 ) ).toThrowError( RagdollError );

	} );

	it( 'fails closed before creating a proxy for an incompatible skeleton', async () => {

		const physics = await Physics.create();
		const root = sourceRig();
		root.getObjectByName( 'Head' ).name = 'unknown-head';

		expect( () => Ragdoll.create( {
			physics,
			root,
			impact: { point: { x: 0, y: 1, z: 0 }, impulse: { x: 1, y: 0, z: 0 } }
		} ) ).toThrowError( /E_RAGDOLL_RIG.*Head/ );

	} );

} );

function sourceRig() {

	const root = new THREE.Group();
	const armature = bone( 'root', [ 0, 0, 0 ] );
	const pelvis = bone( 'pelvis', [ 0, 0.95, 0 ] );
	armature.add( pelvis );
	root.add( armature );

	const spine1 = bone( 'spine_01', [ 0, 0.14, 0 ] );
	const spine2 = bone( 'spine_02', [ 0, 0.12, 0 ] );
	const spine3 = bone( 'spine_03', [ 0, 0.14, 0 ] );
	const neck = bone( 'neck_01', [ 0, 0.14, 0 ] );
	const head = bone( 'Head', [ 0, 0.1, 0 ] );
	pelvis.add( spine1 );
	spine1.add( spine2 );
	spine2.add( spine3 );
	spine3.add( neck );
	neck.add( head );

	arm( spine3, 'l', 1 );
	arm( spine3, 'r', - 1 );
	leg( pelvis, 'l', 1 );
	leg( pelvis, 'r', - 1 );
	root.updateWorldMatrix( true, true );
	return root;

}

function arm( parent, side, direction ) {

	const clavicle = bone( `clavicle_${side}`, [ direction * 0.08, 0.06, 0 ] );
	const upper = bone( `upperarm_${side}`, [ direction * 0.12, 0, 0 ] );
	const lower = bone( `lowerarm_${side}`, [ direction * 0.25, 0, 0 ] );
	const hand = bone( `hand_${side}`, [ direction * 0.24, 0, 0 ] );
	parent.add( clavicle );
	clavicle.add( upper );
	upper.add( lower );
	lower.add( hand );

}

function leg( parent, side, direction ) {

	const thigh = bone( `thigh_${side}`, [ direction * 0.1, - 0.04, 0 ] );
	const calf = bone( `calf_${side}`, [ 0, - 0.43, 0 ] );
	const foot = bone( `foot_${side}`, [ 0, - 0.43, 0.02 ] );
	const ball = bone( `ball_${side}`, [ 0, - 0.08, 0.16 ] );
	parent.add( thigh );
	thigh.add( calf );
	calf.add( foot );
	foot.add( ball );

}

function bone( name, position ) {

	const value = new THREE.Bone();
	value.name = name;
	value.position.fromArray( position );
	return value;

}

function requiredBones( root ) {

	return [
		'pelvis', 'spine_01', 'Head',
		'upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r',
		'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'
	].map( ( name ) => root.getObjectByName( name ) );

}
