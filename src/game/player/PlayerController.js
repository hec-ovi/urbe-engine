import * as THREE from 'three/webgpu';

export const WALK_SPEED = 1.4;
export const RUN_SPEED = 4;
export const CROUCH_SPEED = 0.9;

const SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
const BOB_RATE = 9.5;
const BOB_AMOUNT = 0.035;

/**
 * First person: mouse look under pointer lock, WASD on the ground plane at
 * walking or running pace, and the camera riding the physics capsule at eye
 * height with a little step bob. The controller never moves the camera through
 * the world itself; it asks the body to move and follows what physics allowed.
 */
export class PlayerController {

	constructor( { body, camera, input } ) {

		this.body = body;
		this.camera = camera;
		this.input = input;
		this.yaw = 0;
		this.pitch = 0;
		this.bob = 0;
		this.speed = 0;
		this.frozen = false;
		this.movementLocked = false;
		this.carrierYaw = null;

	}

	lookAt( target ) {

		const feet = this.body.feet;
		this.yaw = Math.atan2( target.x - feet.x, target.z - feet.z ) + Math.PI;

	}

	update( delta ) {

		const zoom = this.input.locked && ! this.frozen && this.input.zooming ? 2 : 1;
		if ( this.camera.zoom !== zoom ) {

			this.camera.zoom = zoom;
			this.camera.updateProjectionMatrix();

		}
		this.#look();
		this.#stance();

		const axis = this.frozen || this.movementLocked ? { x: 0, z: 0 } : this.input.axis();
		const speed = this.body.crouched ? CROUCH_SPEED : ( this.input.running ? RUN_SPEED * ( this.input.runMultiplier ?? 1 ) : WALK_SPEED );
		const moving = axis.x !== 0 || axis.z !== 0;

		const sin = Math.sin( this.yaw );
		const cos = Math.cos( this.yaw );
		const step = speed * delta;

		// Forward is -Z rotated by yaw, and the axis reports W as z = -1, so the
		// forward term is +axis.z on both components. Strafe is the right-hand
		// perpendicular: +X rotated by the same yaw.
		const horizontal = new THREE.Vector3(
			( axis.x * cos + axis.z * sin ) * step,
			0,
			( - axis.x * sin + axis.z * cos ) * step
		);

		if ( this.movementLocked ) {

			this.speed = 0;
			this.bob = 0;

		} else {

			const before = this.body.position.clone();
			this.body.move( horizontal, delta );
			this.speed = before.distanceTo( this.body.position ) / Math.max( delta, 1e-4 );

		}

		this.bob = ! this.movementLocked && moving && this.body.grounded
			? this.bob + delta * BOB_RATE * ( speed / WALK_SPEED )
			: 0;

		const eye = this.body.eye;
		this.camera.position.set(
			eye.x,
			eye.y + Math.sin( this.bob ) * BOB_AMOUNT,
			eye.z
		);
		this.camera.quaternion.setFromEuler( new THREE.Euler( this.pitch, this.yaw, 0, 'YXZ' ) );

	}

	#stance() {

		if ( this.frozen || this.movementLocked ) return;

		this.body.setCrouched( this.input.crouching );

		if ( this.input.consume( 'Space' ) ) {

			// Space from a released crouch stands first. A held C or a low ceiling
			// keeps the short capsule and cannot start an impossible jump.
			if ( this.body.crouched && ! this.input.crouching ) this.body.setCrouched( false );
			this.body.jump();

		}

	}

	/** Starts an authoritative ride and initially faces along its route heading. */
	beginRide( position, heading ) {

		const point = new THREE.Vector3().fromArray( position );
		this.body.beginCarry( point );
		this.movementLocked = true;
		this.carrierYaw = yawOf( heading );
		this.yaw = this.carrierYaw;

	}

	/** Carries the body exactly and turns the current mouse look with bends in the route. */
	carry( position, heading ) {

		const nextYaw = yawOf( heading );
		if ( this.carrierYaw === null ) this.carrierYaw = nextYaw;
		else this.yaw += angleDelta( nextYaw, this.carrierYaw );
		this.carrierYaw = nextYaw;
		this.body.carryTo( new THREE.Vector3().fromArray( position ) );

	}

	/** Places the physical capsule at the published stop and gives movement back. */
	endRide( position ) {

		this.body.endCarry( new THREE.Vector3().fromArray( position ) );
		this.movementLocked = false;
		this.carrierYaw = null;

	}

	#look() {

		const { dx, dy } = this.input.drainLook();

		if ( ! this.input.locked || this.frozen ) return;

		const sensitivity = SENSITIVITY / this.camera.zoom;
		this.yaw -= dx * sensitivity;
		this.pitch = THREE.MathUtils.clamp( this.pitch - dy * sensitivity, - PITCH_LIMIT, PITCH_LIMIT );

	}

	/** Unit vector the player is looking along, flattened to the ground plane. */
	get forward() {

		return new THREE.Vector3( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );

	}

	/** Where the crosshair ray starts. */
	get eye() {

		return this.camera.position;

	}

	/** The crosshair ray: where the centre of the screen actually points. */
	get look() {

		const flat = Math.cos( this.pitch );

		return new THREE.Vector3( - Math.sin( this.yaw ) * flat, Math.sin( this.pitch ), - Math.cos( this.yaw ) * flat );

	}

}

function yawOf( heading ) {

	return Math.atan2( - heading[ 0 ], - heading[ 1 ] );

}

function angleDelta( next, previous ) {

	return Math.atan2( Math.sin( next - previous ), Math.cos( next - previous ) );

}
