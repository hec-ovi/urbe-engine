import * as THREE from 'three/webgpu';

export const EYE_HEIGHT = 1.7;

const RADIUS = 0.32;
const HALF_HEIGHT = 0.55;
const CENTRE_OFFSET = RADIUS + HALF_HEIGHT;
const GRAVITY = - 20;
const TERMINAL = - 45;

/**
 * The player as Rapier sees them: one capsule collider driven by the kinematic
 * character controller. Autostep is what makes curbs and interior stairs
 * walkable; snap-to-ground is what keeps the walk from bouncing down a slope.
 * Nothing here knows about cameras or input.
 */
export class PlayerBody {

	constructor( physics, spawn ) {

		const { rapier, world } = physics;

		this.physics = physics;
		this.position = new THREE.Vector3( spawn.x, spawn.y + CENTRE_OFFSET, spawn.z );
		this.velocityY = 0;
		this.grounded = false;

		this.collider = world.createCollider(
			rapier.ColliderDesc.capsule( HALF_HEIGHT, RADIUS )
				.setTranslation( this.position.x, this.position.y, this.position.z )
		);

		this.controller = world.createCharacterController( 0.02 );
		this.controller.setUp( { x: 0, y: 1, z: 0 } );
		this.controller.enableAutostep( 0.42, 0.28, true );
		this.controller.enableSnapToGround( 0.6 );
		this.controller.setMaxSlopeClimbAngle( ( 55 * Math.PI ) / 180 );
		this.controller.setMinSlopeSlideAngle( ( 40 * Math.PI ) / 180 );
		this.controller.setApplyImpulsesToDynamicBodies( false );

	}

	/** @param horizontal desired XZ movement this step, in metres. */
	move( horizontal, delta ) {

		this.velocityY = Math.max( TERMINAL, this.velocityY + GRAVITY * delta );

		const desired = {
			x: horizontal.x,
			y: this.velocityY * delta,
			z: horizontal.z
		};

		this.controller.computeColliderMovement( this.collider, desired );
		const movement = this.controller.computedMovement();

		this.position.x += movement.x;
		this.position.y += movement.y;
		this.position.z += movement.z;
		this.collider.setTranslation( this.position );

		// computedGrounded misses a character already resting exactly on a
		// trimesh, so treat "asked to fall and was not allowed to" as ground
		// too. Without this the fall speed never resets and the walk never bobs.
		const askedDown = Math.max( 0, - desired.y );
		const gotDown = Math.max( 0, - movement.y );
		this.grounded = this.controller.computedGrounded() || ( askedDown > 1e-5 && gotDown < askedDown - 1e-5 );

		if ( this.grounded && this.velocityY < 0 ) this.velocityY = 0;

	}

	/** Feet on the floor: what the camera and interaction distances measure from. */
	get feet() {

		return new THREE.Vector3( this.position.x, this.position.y - CENTRE_OFFSET, this.position.z );

	}

	get eye() {

		return new THREE.Vector3(
			this.position.x,
			this.position.y - CENTRE_OFFSET + EYE_HEIGHT,
			this.position.z
		);

	}

	teleport( point ) {

		this.position.set( point.x, point.y + CENTRE_OFFSET, point.z );
		this.velocityY = 0;
		this.collider.setTranslation( this.position );

	}

}
