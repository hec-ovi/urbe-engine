import * as THREE from 'three/webgpu';

export const WALK_SPEED = 1.4;
export const RUN_SPEED = 4;

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

	}

	lookAt( target ) {

		const feet = this.body.feet;
		this.yaw = Math.atan2( target.x - feet.x, target.z - feet.z ) + Math.PI;

	}

	update( delta ) {

		this.#look();

		const axis = this.frozen ? { x: 0, z: 0 } : this.input.axis();
		const speed = this.input.running ? RUN_SPEED : WALK_SPEED;
		const moving = axis.x !== 0 || axis.z !== 0;

		const sin = Math.sin( this.yaw );
		const cos = Math.cos( this.yaw );
		const step = speed * delta;

		// Forward is -Z rotated by yaw; strafe is its right-hand perpendicular.
		const horizontal = new THREE.Vector3(
			( axis.x * cos - axis.z * sin ) * step,
			0,
			( - axis.x * sin - axis.z * cos ) * step
		);

		const before = this.body.position.clone();
		this.body.move( horizontal, delta );
		this.speed = before.distanceTo( this.body.position ) / Math.max( delta, 1e-4 );

		this.bob = moving && this.body.grounded
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

	#look() {

		const { dx, dy } = this.input.drainLook();

		if ( ! this.input.locked || this.frozen ) return;

		this.yaw -= dx * SENSITIVITY;
		this.pitch = THREE.MathUtils.clamp( this.pitch - dy * SENSITIVITY, - PITCH_LIMIT, PITCH_LIMIT );

	}

	/** Unit vector the player is looking along, flattened to the ground plane. */
	get forward() {

		return new THREE.Vector3( - Math.sin( this.yaw ), 0, - Math.cos( this.yaw ) );

	}

}
