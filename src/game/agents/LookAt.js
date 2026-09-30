import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';

const DEGREE = Math.PI / 180;
/**
 * How far each part turns at most to look at somebody: the upper spine a
 * little, the neck and head the rest, and how far up or down. Beyond BEHIND
 * the one looked at is at the person's back, and they face their front again
 * rather than wring their neck.
 */
export const LOOK_LIMITS = Object.freeze( { spine: 25 * DEGREE, head: 70 * DEGREE, up: 25 * DEGREE, down: 35 * DEGREE } );
const BEHIND = 125 * DEGREE;
/** The share of a turn the spine takes before its limit, and how the rest splits between the neck and the head. */
const SPINE_SHARE = 0.3;
const NECK_SHARE = 0.4;
/** Seconds a turn takes to follow its aim, and the look to come in or go. */
const FOLLOW = 0.3;
const EASE = 0.3;
/** A frame longer than this is taken as this long. */
const LONGEST = 0.25;
/** Below this the look has gone and the clip's pose is left alone. */
const REST = 1e-2;

const UP = new Vector3( 0, 1, 0 );
const matrix = new Matrix4();
const parentWorld = new Quaternion();
const posedWorld = new Quaternion();
const body = new Quaternion();
const turn = new Quaternion();
const tilt = new Quaternion();
const side = new Vector3();
const forward = new Vector3();
const head = new Vector3();
const toward = new Vector3();

/**
 * A person turning their upper spine, neck and head to look at a point, over
 * whatever their clip poses: a seated person cannot turn off their chair, so
 * they look round from it; a standing one already faces the player and
 * follows their eye up and down. The turn is split up the body, spine first
 * and within LOOK_LIMITS, eased as a critically damped spring and faded in
 * and out, and laid on after the mixer: `rest()` hands the bones back to the
 * clip before the mixer runs, `update(delta, point)` looks this frame, with
 * `point` null once there is nothing to look at. Nothing is allocated a frame.
 */
export class LookAt {

	/** The current turn in radians, yaw to the person's left and pitch up, and how much of it shows. */
	angles = { yaw: 0, pitch: 0 };
	weight = 0;
	#aim = { yaw: 0, pitch: 0 };
	#velocity = { yaw: 0, pitch: 0 };
	#joints;
	#root;
	#applied = false;
	/** Each joint's share of the turn this frame: spine, neck, head. */
	#yaws = new Float64Array( 3 );
	#pitches = new Float64Array( 3 );

	/** @param root a person's rig, with its spine_03, neck_01 and Head */
	constructor( root ) {

		this.#root = root;
		const bone = ( name ) => {

			let found = null;
			root.traverse( ( node ) => { if ( ! found && node.isBone && node.name === name ) found = node; } );
			return found;

		};
		this.#joints = [ 'spine_03', 'neck_01', 'Head' ].map( ( name ) => ( { bone: bone( name ), pose: new Quaternion() } ) );
		if ( this.#joints.some( ( joint ) => ! joint.bone ) ) this.#joints = [];

	}

	/** Puts the spine, neck and head back where the clip left them, for the mixer to pose the next frame. */
	rest() {

		if ( ! this.#applied ) return;
		for ( const joint of this.#joints ) joint.bone.quaternion.copy( joint.pose );
		this.#applied = false;

	}

	/**
	 * Moves on by `delta` seconds and turns towards `point` (a world position,
	 * the player's eye), or back to the clip's pose while it is null. The
	 * rig's world matrices must be this frame's pose.
	 */
	update( delta, point ) {

		if ( ! this.#joints.length ) return;
		const step = Math.min( Math.max( delta, 0 ), LONGEST );
		if ( point ) this.#aimAt( point );
		else this.#aim.yaw = this.#aim.pitch = 0;
		this.weight += ( ( point ? 1 : 0 ) - this.weight ) * ( 1 - Math.exp( - step / EASE ) );
		this.#follow( 'yaw', step );
		this.#follow( 'pitch', step );
		if ( ! point && this.weight < REST ) {

			this.weight = this.angles.yaw = this.angles.pitch = this.#velocity.yaw = this.#velocity.pitch = 0;
			return;

		}
		this.#apply();

	}

	/** Where the head should turn to see `point`, in the body's own frame and within its limits. */
	#aimAt( point ) {

		head.setFromMatrixPosition( this.#joints[ 2 ].bone.matrixWorld );
		toward.copy( point ).sub( head );
		// The body's forward and its left, +X, as its root faces.
		this.#root.getWorldQuaternion( body );
		side.set( 1, 0, 0 ).applyQuaternion( body );
		forward.set( 0, 0, 1 ).applyQuaternion( body );
		const across = toward.dot( side );
		const ahead = toward.dot( forward );
		const yaw = Math.atan2( across, ahead );
		const level = Math.hypot( across, ahead );
		if ( Math.abs( yaw ) > BEHIND ) {

			this.#aim.yaw = this.#aim.pitch = 0;
			return;

		}
		this.#aim.yaw = Math.max( - ( LOOK_LIMITS.spine + LOOK_LIMITS.head ), Math.min( LOOK_LIMITS.spine + LOOK_LIMITS.head, yaw ) );
		this.#aim.pitch = Math.max( - LOOK_LIMITS.down, Math.min( LOOK_LIMITS.up, Math.atan2( toward.y, level ) ) );

	}

	/** Eases one axis toward its aim as a critically damped spring, stable for any step (Game Programming Gems 4, 1.10). */
	#follow( axis, step ) {

		const omega = 2 / FOLLOW;
		const x = omega * step;
		const decay = 1 / ( 1 + x + 0.48 * x * x + 0.235 * x * x * x );
		const change = this.angles[ axis ] - this.#aim[ axis ];
		const pull = ( this.#velocity[ axis ] + omega * change ) * step;
		this.#velocity[ axis ] = ( this.#velocity[ axis ] - omega * pull ) * decay;
		this.angles[ axis ] = this.#aim[ axis ] + ( change + pull ) * decay;

	}

	/**
	 * Turns each joint in the world about the up axis by its share of the yaw,
	 * then the neck and head about the side axis they then face across by
	 * their share of the pitch, and keeps the result as the joint's local turn.
	 */
	#apply() {

		const yaw = this.angles.yaw * this.weight;
		const pitch = this.angles.pitch * this.weight;
		const spine = Math.max( - LOOK_LIMITS.spine, Math.min( LOOK_LIMITS.spine, yaw * SPINE_SHARE ) );
		const rest = Math.max( - LOOK_LIMITS.head, Math.min( LOOK_LIMITS.head, yaw - spine ) );
		const yaws = this.#yaws;
		const pitches = this.#pitches;
		yaws[ 0 ] = spine;
		yaws[ 1 ] = rest * NECK_SHARE;
		yaws[ 2 ] = rest * ( 1 - NECK_SHARE );
		pitches[ 1 ] = pitch * NECK_SHARE;
		pitches[ 2 ] = pitch * ( 1 - NECK_SHARE );
		this.#root.getWorldQuaternion( body );
		let turned = 0;
		// The spine's parent as posed; each joint after it has its parent's new turn.
		parentWorld.setFromRotationMatrix( matrix.extractRotation( this.#joints[ 0 ].bone.parent.matrixWorld ) );
		for ( let i = 0; i < this.#joints.length; i ++ ) {

			const joint = this.#joints[ i ];
			joint.pose.copy( joint.bone.quaternion );
			// The joint in the world as posed under its parent.
			posedWorld.copy( parentWorld ).multiply( joint.bone.quaternion );
			turned += yaws[ i ];
			turn.setFromAxisAngle( UP, yaws[ i ] );
			// Looking up turns the forward toward +Y: negatively about the side the body now faces across.
			side.set( 1, 0, 0 ).applyQuaternion( body ).applyAxisAngle( UP, turned );
			tilt.setFromAxisAngle( side, - pitches[ i ] );
			posedWorld.premultiply( turn ).premultiply( tilt );
			// Back into the parent's frame: the joint's own turn.
			joint.bone.quaternion.copy( parentWorld ).invert().multiply( posedWorld );
			parentWorld.copy( posedWorld );

		}
		this.#applied = true;

	}

}
