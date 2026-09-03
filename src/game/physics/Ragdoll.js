import * as THREE from 'three/webgpu';
import { RagdollBoundary } from './RagdollBoundary.js';
import { RagdollError } from './RagdollError.js';

const Y_AXIS = new THREE.Vector3( 0, 1, 0 );
const RAGDOLL_GROUP = 0x0004;
const RAGDOLL_FILTER = 0xffff & ~ RAGDOLL_GROUP;
const COLLISION_GROUPS = ( RAGDOLL_GROUP << 16 ) | RAGDOLL_FILTER;

// The audited Universal Animation Library skeleton. A segment starts at its
// named bone and ends at the next named joint. Endpoint bodies use a sphere.
const PARTS = Object.freeze( [
	part( 'pelvis', 'pelvis', 'spine_01', null, null, 0.14, 10 ),
	part( 'torso', 'spine_01', 'Head', 'pelvis', 'spine_01', 0.15, 18 ),
	part( 'head', 'Head', null, 'torso', 'Head', 0.12, 5 ),
	part( 'upper-arm-l', 'upperarm_l', 'lowerarm_l', 'torso', 'upperarm_l', 0.065, 3 ),
	part( 'lower-arm-l', 'lowerarm_l', 'hand_l', 'upper-arm-l', 'lowerarm_l', 0.055, 2 ),
	part( 'hand-l', 'hand_l', null, 'lower-arm-l', 'hand_l', 0.065, 1 ),
	part( 'upper-arm-r', 'upperarm_r', 'lowerarm_r', 'torso', 'upperarm_r', 0.065, 3 ),
	part( 'lower-arm-r', 'lowerarm_r', 'hand_r', 'upper-arm-r', 'lowerarm_r', 0.055, 2 ),
	part( 'hand-r', 'hand_r', null, 'lower-arm-r', 'hand_r', 0.065, 1 ),
	part( 'thigh-l', 'thigh_l', 'calf_l', 'pelvis', 'thigh_l', 0.09, 7 ),
	part( 'calf-l', 'calf_l', 'foot_l', 'thigh-l', 'calf_l', 0.075, 4.5 ),
	part( 'foot-l', 'foot_l', 'ball_l', 'calf-l', 'foot_l', 0.065, 1 ),
	part( 'thigh-r', 'thigh_r', 'calf_r', 'pelvis', 'thigh_r', 0.09, 7 ),
	part( 'calf-r', 'calf_r', 'foot_r', 'thigh-r', 'calf_r', 0.075, 4.5 ),
	part( 'foot-r', 'foot_r', 'ball_r', 'calf-r', 'foot_r', 0.065, 1 )
] );

let sharedBoundary;

/**
 * One articulated physical projection of the installed Source character rig.
 * Dynamic Rapier parts start at the currently rendered pose and drive those
 * same bones until disposal. No alternate skeleton or proxy mesh is accepted.
 */
export class Ragdoll {

	static create( { physics, root, impact, boundary = sharedBoundary ??= new RagdollBoundary() } ) {

		if ( ! physics?.world || ! physics?.rapier ) {

			throw new RagdollError( 'E_RAGDOLL_INPUT', 'Ragdoll requires the live engine physics world' );

		}
		if ( ! root?.isObject3D ) throw new RagdollError( 'E_RAGDOLL_RIG', 'Ragdoll requires a Three.js character root' );
		boundary.input( impact );

		return new Ragdoll( { physics, root, impact, boundary } );

	}

	constructor( { physics, root, impact, boundary } ) {

		this.physics = physics;
		this.root = root;
		this.boundary = boundary;
		this.parts = new Map();
		this.joints = [];
		this.disposed = false;
		this.elapsedSeconds = 0;

		root.updateWorldMatrix( true, true );
		const bones = rigBones( root );

		try {

			for ( const descriptor of PARTS ) this.#createPart( descriptor, bones );
			for ( const descriptor of PARTS ) if ( descriptor.parent ) this.#join( descriptor, bones );
			this.#apply( impact );
			this.summary = boundary.output( {
				bodies: this.parts.size,
				joints: this.joints.length,
				totalMassKg: PARTS.reduce( ( total, descriptor ) => total + descriptor.mass, 0 )
			} );

		} catch ( error ) {

			this.dispose();
			throw error;

		}

	}

	/** Poses the exact source skeleton from the current dynamic bodies. */
	update( deltaSeconds = 0 ) {

		if ( this.disposed ) throw new RagdollError( 'E_RAGDOLL_DISPOSED', 'Ragdoll is disposed' );
		if ( ! Number.isFinite( deltaSeconds ) || deltaSeconds < 0 ) {

			throw new RagdollError( 'E_RAGDOLL_INPUT', 'Ragdoll deltaSeconds must be finite and non-negative' );

		}
		this.elapsedSeconds += deltaSeconds;
		this.root.updateWorldMatrix( true, true );

		for ( const descriptor of PARTS ) {

			const state = this.parts.get( descriptor.id );
			const position = vector( state.body.translation() );
			const rotation = quaternion( state.body.rotation() );
			const worldPosition = state.boneOffset.clone().applyQuaternion( rotation ).add( position );
			const worldRotation = rotation.multiply( state.boneRotation );
			setWorldTransform( state.bone, worldPosition, worldRotation );

		}

		return this;

	}

	get sleeping() {

		return this.parts.size > 0 && [ ...this.parts.values() ].every( ( state ) => state.body.isSleeping() );

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		for ( const joint of this.joints.reverse() ) this.physics.world.removeImpulseJoint( joint, false );
		for ( const state of [ ...this.parts.values() ].reverse() ) this.physics.world.removeRigidBody( state.body );
		this.joints.length = 0;
		this.parts.clear();

	}

	#createPart( descriptor, bones ) {

		const bone = bones.get( descriptor.bone );
		const start = bone.getWorldPosition( new THREE.Vector3() );
		const end = descriptor.end ? bones.get( descriptor.end ).getWorldPosition( new THREE.Vector3() ) : null;
		const center = end ? start.clone().add( end ).multiplyScalar( 0.5 ) : start.clone();
		const bodyRotation = end ? segmentRotation( start, end, descriptor.id ) : bone.getWorldQuaternion( new THREE.Quaternion() );
		const rigid = this.physics.rapier.RigidBodyDesc.dynamic()
			.setTranslation( center.x, center.y, center.z )
			.setRotation( rotationRecord( bodyRotation ) )
			.setLinearDamping( 0.35 )
			.setAngularDamping( 1.4 )
			.setCcdEnabled( true );
		const body = this.physics.world.createRigidBody( rigid );
		const collider = end
			? this.physics.rapier.ColliderDesc.capsule(
				Math.max( 0.015, start.distanceTo( end ) / 2 - descriptor.radius ), descriptor.radius
			)
			: this.physics.rapier.ColliderDesc.ball( descriptor.radius );
		collider.setMass( descriptor.mass ).setFriction( 0.72 ).setRestitution( 0 ).setCollisionGroups( COLLISION_GROUPS );
		this.physics.world.createCollider( collider, body );

		const inverseBodyRotation = bodyRotation.clone().invert();
		this.parts.set( descriptor.id, {
			bone,
			body,
			boneOffset: start.clone().sub( center ).applyQuaternion( inverseBodyRotation ),
			boneRotation: inverseBodyRotation.multiply( bone.getWorldQuaternion( new THREE.Quaternion() ) )
		} );

	}

	#join( descriptor, bones ) {

		const parent = this.parts.get( descriptor.parent ).body;
		const child = this.parts.get( descriptor.id ).body;
		const pivot = bones.get( descriptor.joint ).getWorldPosition( new THREE.Vector3() );
		const joint = this.physics.rapier.JointData.spherical(
			localPoint( parent, pivot ), localPoint( child, pivot )
		);
		this.joints.push( this.physics.world.createImpulseJoint( joint, parent, child, true ) );

	}

	#apply( impact ) {

		const point = vector( impact.point );
		const impulse = impact.impulse;
		let nearest = null;
		let distance = Infinity;
		for ( const state of this.parts.values() ) {

			const gap = point.distanceToSquared( vector( state.body.translation() ) );
			if ( gap < distance ) { nearest = state; distance = gap; }

		}
		nearest.body.applyImpulseAtPoint( impulse, impact.point, true );

	}

}

function part( id, bone, end, parent, joint, radius, mass ) {

	return Object.freeze( { id, bone, end, parent, joint, radius, mass } );

}

function rigBones( root ) {

	const required = new Set( PARTS.flatMap( ( descriptor ) => [ descriptor.bone, descriptor.end, descriptor.joint ] ).filter( Boolean ) );
	const bones = new Map();
	root.traverse( ( node ) => {

		if ( ! node.isBone || ! required.has( node.name ) ) return;
		if ( bones.has( node.name ) ) throw new RagdollError( 'E_RAGDOLL_RIG', `Character rig repeats bone ${node.name}` );
		bones.set( node.name, node );

	} );
	const missing = [ ...required ].filter( ( name ) => ! bones.has( name ) );
	if ( missing.length ) throw new RagdollError( 'E_RAGDOLL_RIG', `Character rig is missing ${missing.join( ', ' )}` );
	return bones;

}

function segmentRotation( start, end, id ) {

	const direction = end.clone().sub( start );
	if ( direction.length() < 0.03 ) throw new RagdollError( 'E_RAGDOLL_RIG', `Character rig segment ${id} is too short` );
	return new THREE.Quaternion().setFromUnitVectors( Y_AXIS, direction.normalize() );

}

function localPoint( body, worldPoint ) {

	const position = vector( body.translation() );
	const inverse = quaternion( body.rotation() ).invert();
	return record( worldPoint.clone().sub( position ).applyQuaternion( inverse ) );

}

function setWorldTransform( bone, worldPosition, worldRotation ) {

	const parent = bone.parent;
	if ( ! parent ) {

		bone.position.copy( worldPosition );
		bone.quaternion.copy( worldRotation );
		bone.updateWorldMatrix( false, true );
		return;

	}
	parent.updateWorldMatrix( true, false );
	const inverse = parent.matrixWorld.clone().invert();
	bone.position.copy( worldPosition ).applyMatrix4( inverse );
	const parentRotation = parent.getWorldQuaternion( new THREE.Quaternion() );
	bone.quaternion.copy( parentRotation.invert().multiply( worldRotation ) );
	bone.updateWorldMatrix( false, true );

}

function vector( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}

function quaternion( value ) {

	return new THREE.Quaternion( value.x, value.y, value.z, value.w );

}

function record( value ) {

	return { x: value.x, y: value.y, z: value.z };

}

function rotationRecord( value ) {

	return { x: value.x, y: value.y, z: value.z, w: value.w };

}
