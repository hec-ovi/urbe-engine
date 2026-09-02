import * as THREE from 'three/webgpu';

export const EYE_HEIGHT = 1.7;
export const BODY_RADIUS = 0.32;
export const CROUCH_EYE_HEIGHT = 1.05;
export const JUMP_SPEED = 6.5;

const STAND_HALF_HEIGHT = 0.55;
const CROUCH_HALF_HEIGHT = 0.255;
const GRAVITY = - 20;
const TERMINAL = - 45;
const UP = { x: 0, y: 0, z: 0, w: 1 };

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
		this.halfHeight = STAND_HALF_HEIGHT;
		this.position = new THREE.Vector3( spawn.x, spawn.y + this.centreOffset, spawn.z );
		this.velocityY = 0;
		this.grounded = false;
		this.crouched = false;

		this.collider = world.createCollider(
			rapier.ColliderDesc.capsule( this.halfHeight, BODY_RADIUS )
				.setTranslation( this.position.x, this.position.y, this.position.z )
		);

		this.controller = world.createCharacterController( 0.02 );
		this.controller.setUp( { x: 0, y: 1, z: 0 } );
		// Steps up to 0.42 m; a tread is 0.28 m (interior STAIR.tread), and the
		// width the step test asks for stays under it so every tread counts.
		this.controller.enableAutostep( 0.42, 0.2, true );
		this.controller.enableSnapToGround( 0.6 );
		this.controller.setMaxSlopeClimbAngle( ( 55 * Math.PI ) / 180 );
		this.controller.setMinSlopeSlideAngle( ( 40 * Math.PI ) / 180 );
		this.controller.setApplyImpulsesToDynamicBodies( false );

	}

	/** Starts one jump only from supported, standing feet. */
	jump() {

		if ( ! this.grounded || this.crouched ) return false;

		this.velocityY = JUMP_SPEED;
		this.grounded = false;

		return true;

	}

	/**
	 * Changes the real capsule and eye height without moving the feet. Standing
	 * is refused while the full-height capsule would overlap a ceiling.
	 */
	setCrouched( wanted ) {

		if ( wanted === this.crouched ) return true;
		if ( ! wanted && ! this.canStand() ) return false;

		const floor = this.feet.y;
		this.halfHeight = wanted ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
		this.crouched = wanted;
		this.position.y = floor + this.centreOffset;
		this.collider.setHalfHeight( this.halfHeight );
		this.collider.setTranslation( this.position );

		return true;

	}

	/** Whether the standing capsule fits above the current foot point. */
	canStand() {

		if ( ! this.crouched ) return true;

		const feet = this.feet;
		const centre = { x: feet.x, y: feet.y + BODY_RADIUS + STAND_HALF_HEIGHT, z: feet.z };
		const shape = new this.physics.rapier.Capsule( STAND_HALF_HEIGHT, BODY_RADIUS );
		let blocked = false;

		this.physics.world.intersectionsWithShape(
			centre, UP, shape,
			() => { blocked = true; return false; },
			undefined, undefined, this.collider
		);

		return ! blocked;

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

	/**
	 * Slide the capsule sideways out of something that moved into it. No
	 * gravity and no change to the fall state, and still resolved against the
	 * world, so a push can never shove the player through a wall.
	 * @param offset desired XZ correction in metres
	 */
	push( offset ) {

		if ( offset.x === 0 && offset.z === 0 ) return;

		this.controller.computeColliderMovement( this.collider, { x: offset.x, y: 0, z: offset.z } );
		const movement = this.controller.computedMovement();

		this.position.x += movement.x;
		this.position.z += movement.z;
		this.collider.setTranslation( this.position );

	}

	/** Feet on the floor: what the camera and interaction distances measure from. */
	get feet() {

		return new THREE.Vector3( this.position.x, this.position.y - this.centreOffset, this.position.z );

	}

	get eye() {

		return new THREE.Vector3(
			this.position.x,
			this.feet.y + ( this.crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT ),
			this.position.z
		);

	}

	get centreOffset() {

		return BODY_RADIUS + this.halfHeight;

	}

	teleport( point ) {

		this.position.set( point.x, point.y + this.centreOffset, point.z );
		this.velocityY = 0;
		this.collider.setTranslation( this.position );

	}

}
