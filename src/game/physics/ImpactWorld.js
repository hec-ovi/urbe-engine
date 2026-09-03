import * as THREE from 'three/webgpu';
import { RagdollBoundary } from './RagdollBoundary.js';
import { RagdollError } from './RagdollError.js';

const PERSON_RADIUS = 0.32;
const PERSON_HALF_HEIGHT = 0.55;
const CAR_HALF = { x: 0.95, y: 0.65, z: 2.3 };
const MIN_IMPACT_SPEED = 2;
const PERSON_GROUP = 0x0001;
const VEHICLE_GROUP = 0x0002;
const PERSON_COLLISIONS = ( PERSON_GROUP << 16 ) | VEHICLE_GROUP;
const VEHICLE_COLLISIONS = ( VEHICLE_GROUP << 16 ) | PERSON_GROUP;

/**
 * Rapier sensor projection for live pedestrians and generated road vehicles.
 * It reports a vehicle impact once, then the host replaces that pedestrian's
 * kinematic sensor with an articulated dynamic ragdoll.
 */
export class ImpactWorld {

	constructor( physics, boundary = new RagdollBoundary() ) {

		if ( ! physics?.world || ! physics?.rapier ) throw new RagdollError( 'E_RAGDOLL_INPUT', 'ImpactWorld requires engine physics' );
		this.physics = physics;
		this.boundary = boundary;
		this.people = new Map();
		this.vehicles = new Map();
		this.triggered = new Set();
		this.disposed = false;

	}

	/** Synchronizes exact render positions for the next fixed physics step. */
	sync( { people, vehicles } ) {

		this.#open();
		if ( ! Array.isArray( people ) || ! Array.isArray( vehicles ) ) {

			throw new RagdollError( 'E_RAGDOLL_INPUT', 'ImpactWorld sync requires people and vehicles arrays' );

		}
		this.#reconcilePeople( people );
		this.#reconcileVehicles( vehicles );

	}

	/** Returns only contacts measured by Rapier's kinematic sensor pairs. */
	drain() {

		this.#open();
		const events = [];
		for ( const vehicle of this.vehicles.values() ) {

			if ( vehicle.source.speed < MIN_IMPACT_SPEED ) continue;
			for ( const person of this.people.values() ) {

				if ( this.triggered.has( person.id ) ) continue;
				if ( ! this.physics.world.intersectionPair( vehicle.collider, person.collider ) ) continue;
				const direction = new THREE.Vector3(
					Math.sin( vehicle.source.heading ), 0, Math.cos( vehicle.source.heading )
				);
				const speed = Math.min( 18, vehicle.source.speed );
				const point = person.source.position.clone().add( new THREE.Vector3( 0, 1.05, 0 ) );
				events.push( {
					personId: person.id,
					vehicleId: vehicle.id,
					point: record( point ),
					impulse: record( direction.multiplyScalar( speed * 7.5 ).setY( Math.min( 12, speed * 0.75 ) ) )
				} );
				this.triggered.add( person.id );
				person.collider.setEnabled( false );

			}

		}
		return this.boundary.impacts( events.sort( ( left, right ) =>
			left.personId.localeCompare( right.personId ) || left.vehicleId.localeCompare( right.vehicleId ) ) );

	}

	/** Lets a rejected or recovered body enter collision detection again. */
	release( personId ) {

		this.triggered.delete( personId );
		this.people.get( personId )?.collider.setEnabled( true );

	}

	dispose() {

		if ( this.disposed ) return;
		this.disposed = true;
		for ( const state of [ ...this.people.values(), ...this.vehicles.values() ] ) {

			this.physics.world.removeRigidBody( state.body );

		}
		this.people.clear();
		this.vehicles.clear();
		this.triggered.clear();

	}

	#reconcilePeople( people ) {

		const live = new Set();
		for ( const source of people ) {

			if ( ! source?.id || ! vectorLike( source.position ) || source.fallen ) continue;
			live.add( source.id );
			let state = this.people.get( source.id );
			const center = source.position.clone().add( new THREE.Vector3( 0, PERSON_RADIUS + PERSON_HALF_HEIGHT, 0 ) );
			if ( ! state ) {

				state = this.#sensor(
					source.id,
					this.physics.rapier.ColliderDesc.capsule( PERSON_HALF_HEIGHT, PERSON_RADIUS )
						.setCollisionGroups( PERSON_COLLISIONS ),
					center,
					new THREE.Quaternion()
				);
				this.people.set( source.id, state );

			}
			state.source = source;
			state.body.setNextKinematicTranslation( record( center ) );
			if ( ! this.triggered.has( source.id ) ) state.collider.setEnabled( true );

		}
		this.#dropMissing( this.people, live );

	}

	#reconcileVehicles( vehicles ) {

		const live = new Set();
		const rotation = new THREE.Euler( 0, 0, 0, 'YXZ' );
		for ( const source of vehicles ) {

			if ( ! source?.id || ! vectorLike( source.position ) || ! Number.isFinite( source.heading ) || ! Number.isFinite( source.speed ) ) continue;
			live.add( source.id );
			let state = this.vehicles.get( source.id );
			const center = source.position.clone().add( new THREE.Vector3( 0, CAR_HALF.y, 0 ) );
			const orientation = new THREE.Quaternion().setFromEuler( rotation.set( - ( source.pitch ?? 0 ), source.heading, 0 ) );
			if ( ! state ) {

				state = this.#sensor(
					source.id,
					this.physics.rapier.ColliderDesc.cuboid( CAR_HALF.x, CAR_HALF.y, CAR_HALF.z )
						.setCollisionGroups( VEHICLE_COLLISIONS ),
					center,
					orientation
				);
				this.vehicles.set( source.id, state );

			}
			state.source = source;
			state.body.setNextKinematicTranslation( record( center ) );
			state.body.setNextKinematicRotation( rotationRecord( orientation ) );

		}
		this.#dropMissing( this.vehicles, live );

	}

	#sensor( id, colliderDescriptor, position, rotation ) {

		const body = this.physics.world.createRigidBody(
			this.physics.rapier.RigidBodyDesc.kinematicPositionBased()
				.setTranslation( position.x, position.y, position.z )
				.setRotation( rotationRecord( rotation ) )
		);
		colliderDescriptor.setSensor( true ).setActiveCollisionTypes( this.physics.rapier.ActiveCollisionTypes.KINEMATIC_KINEMATIC );
		const collider = this.physics.world.createCollider( colliderDescriptor, body );
		return { id, source: null, body, collider };

	}

	#dropMissing( collection, live ) {

		for ( const [ id, state ] of collection ) {

			if ( live.has( id ) ) continue;
			this.physics.world.removeRigidBody( state.body );
			collection.delete( id );
			this.triggered.delete( id );

		}

	}

	#open() {

		if ( this.disposed ) throw new RagdollError( 'E_RAGDOLL_DISPOSED', 'ImpactWorld is disposed' );

	}

}

function vectorLike( value ) {

	return value && [ value.x, value.y, value.z ].every( Number.isFinite );

}

function record( value ) {

	return { x: value.x, y: value.y, z: value.z };

}

function rotationRecord( value ) {

	return { x: value.x, y: value.y, z: value.z, w: value.w };

}
