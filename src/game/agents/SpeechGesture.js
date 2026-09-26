import { Quaternion, Vector3 } from 'three/webgpu';

const DEGREE = Math.PI / 180;
/** How far the head turns at most with its neck, each way: a nod, a turn and a tilt. */
export const SPEECH_LIMITS = Object.freeze( { pitch: 4 * DEGREE, yaw: 5 * DEGREE, roll: 2.5 * DEGREE } );
const AXES = Object.keys( SPEECH_LIMITS );
/** The share of each turn the neck takes, the head taking the rest. */
const JOINTS = [ [ 'neck_01', 0.4 ], [ 'Head', 0.6 ] ];
/** Seconds the loudness envelope rises and falls in. */
const ATTACK = 0.03;
const RELEASE = 0.12;
/** Seconds the loudest of late rises to a louder envelope in, and forgets it in; never below LOUDEST_FLOOR. */
const LOUDEST_RISE = 0.15;
const LOUDEST_FALL = 2.5;
const LOUDEST_FLOOR = 0.02;
/** An envelope this many times the loudest of late is emphasis: a stressed word, or the first after a pause. */
const EMPHASIS = 1.25;
/** Seconds the running mean of the envelope, as a share of the loudest, follows over. */
const MEAN = 0.5;
/** A nod: its length in seconds, the least wait before the next and its size down, from 0.7 to 1.3 times NOD. */
const NOD_LENGTH = 0.4;
const NOD_GAP = 0.45;
const NOD = 3 * DEGREE;
/** Seconds the head takes to follow where it heads, and the voice's presence to come and go. */
const FOLLOW = 0.15;
const PRESENCE = 0.25;
/** Seconds a line's sway takes to come in. */
const RAMP = 0.5;
/** With the voice gone, a presence and a turn this small rest. */
const REST_PRESENCE = 1e-3;
const REST = 1e-4;
/** A frame longer than this is taken as this long. */
const LONGEST = 0.25;

const turn = new Quaternion();
const part = new Quaternion();

/**
 * Head and neck motion of the focused person while their voice plays: a nod
 * on each loudness peak well above the speech around it, a dip with each
 * syllable and a slow sway, layered after the animation mixer so the talk
 * clip still plays under it. `rest()` hands the bones back to the clip before
 * the mixer runs, and `update(delta, speech)` layers this frame's turn after
 * it. Each axis follows its aim as a critically damped spring and is bounded
 * softly within SPEECH_LIMITS. A line's sway and the sizes of its nods come
 * from its seed, so a line heard again moves the same way. Once the voice
 * stops the head eases back to the clip and is left alone. The brows stay
 * put: the pack's Eyebrows mesh carries the eyelashes too, all on Head.
 */
export class SpeechGesture {

	/** The current turn in radians, head and neck together; positive pitch looks down. */
	angles = { pitch: 0, yaw: 0, roll: 0 };
	#joints;
	/** Each axis's spring before its bound, its velocity and its aim. */
	#springs = { pitch: 0, yaw: 0, roll: 0 };
	#velocity = { pitch: 0, yaw: 0, roll: 0 };
	#aims = { pitch: 0, yaw: 0, roll: 0 };
	/** Per axis: a slow and a faster sine's rate (Hz) and phase, the line's own. */
	#sway = { pitch: [ 0, 0, 0, 0 ], yaw: [ 0, 0, 0, 0 ], roll: [ 0, 0, 0, 0 ] };
	/** The nod under way: seconds into it, and its size on each axis. */
	#nod = { time: NOD_GAP, pitch: 0, yaw: 0, roll: 0 };
	/** The line heard last. */
	#speech = null;
	#random = null;
	/** Seconds into the line. */
	#time = 0;
	#envelope = 0;
	#loudest = LOUDEST_FLOOR;
	/** The envelope as a share of the loudest, and its running mean. */
	#drive = 0;
	#mean = 0;
	#presence = 0;
	#applied = false;
	#resting = true;

	/** @param root a person's rig standing in its rest pose */
	constructor( root ) {

		root.updateMatrixWorld( true );
		const toRoot = root.getWorldQuaternion( new Quaternion() ).invert();
		this.#joints = JOINTS.map( ( [ name, share ] ) => {

			let bone = null;
			root.traverse( ( node ) => { if ( ! bone && node.isBone && node.name === name ) bone = node; } );
			if ( ! bone ) return null;
			// The root's side, up and forward, as the bone holds them.
			const fromBone = toRoot.clone().multiply( bone.getWorldQuaternion( new Quaternion() ) ).invert();
			return {
				bone, share, pose: new Quaternion(),
				pitch: new Vector3( 1, 0, 0 ).applyQuaternion( fromBone ),
				yaw: new Vector3( 0, 1, 0 ).applyQuaternion( fromBone ),
				roll: new Vector3( 0, 0, 1 ).applyQuaternion( fromBone )
			};

		} ).filter( Boolean );

	}

	/** Puts the head and neck back where the clip left them, for the mixer to pose the next frame. */
	rest() {

		if ( ! this.#applied ) return;
		for ( const joint of this.#joints ) joint.bone.quaternion.copy( joint.pose );
		this.#applied = false;

	}

	/**
	 * Moves on by `delta` seconds and turns the head and neck after the clip's
	 * pose. `speech` is the line playing, `{ seed, loudness() }`, the same
	 * object all through it, or null while the person's voice is not heard.
	 */
	update( delta, speech ) {

		if ( speech && speech !== this.#speech ) this.#begin( speech );
		if ( ! speech && this.#resting ) return;
		const step = Math.min( Math.max( delta, 0 ), LONGEST );
		this.#time += step;
		this.#listen( speech ? speech.loudness() : 0, step );
		this.#aim( step, speech );
		for ( const axis of AXES ) this.#follow( axis, step );
		this.#resting = ! speech && this.#presence < REST_PRESENCE && this.#still();
		if ( this.#resting ) this.#settle();
		else this.#apply();

	}

	/** A new line: its own sway and nods, from its seed. */
	#begin( speech ) {

		this.#speech = speech;
		this.#random = random( speech.seed );
		this.#time = 0;
		for ( const axis of AXES ) {

			const sway = this.#sway[ axis ];
			sway[ 0 ] = 0.12 + 0.13 * this.#random();
			sway[ 1 ] = 2 * Math.PI * this.#random();
			sway[ 2 ] = 0.3 + 0.25 * this.#random();
			sway[ 3 ] = 2 * Math.PI * this.#random();

		}

	}

	/**
	 * Follows the loudness: its envelope, the loudest of late, the envelope's
	 * share of that and its running mean. The envelope outruns the loudest on
	 * a word louder than the ones before it, or the first after a pause, and
	 * the head nods.
	 */
	#listen( level, step ) {

		const envelope = this.#envelope += ( level - this.#envelope ) * ease( step, level > this.#envelope ? ATTACK : RELEASE );
		const emphasis = envelope > EMPHASIS * this.#loudest;
		this.#loudest = Math.max( LOUDEST_FLOOR, this.#loudest + ( envelope - this.#loudest ) * ease( step, envelope > this.#loudest ? LOUDEST_RISE : LOUDEST_FALL ) );
		this.#drive = Math.min( 1, envelope / this.#loudest );
		this.#mean += ( this.#drive - this.#mean ) * ease( step, MEAN );
		const nod = this.#nod;
		nod.time += step;
		if ( ! emphasis || nod.time < NOD_GAP ) return;
		nod.time = 0;
		nod.pitch = NOD * ( 0.7 + 0.6 * this.#random() );
		nod.yaw = NOD * ( this.#random() - 0.5 );
		nod.roll = 0.5 * NOD * ( this.#random() - 0.5 );

	}

	/** Where each axis heads now: the line's sway, a dip with each syllable and the nod under way, while the voice is there. */
	#aim( step, speech ) {

		this.#presence += ( ( speech ? 1 : 0 ) - this.#presence ) * ease( step, PRESENCE );
		const presence = this.#presence;
		const syllable = this.#drive - this.#mean;
		const sway = presence * smoothstep( this.#time / RAMP ) * ( 0.6 + 0.4 * this.#mean );
		const nod = this.#nod.time < NOD_LENGTH ? presence * Math.sin( Math.PI * this.#nod.time / NOD_LENGTH ) ** 2 : 0;
		const aims = this.#aims;
		aims.pitch = presence * SPEECH_LIMITS.pitch * 0.3 * syllable + sway * SPEECH_LIMITS.pitch * 0.3 * this.#wave( 'pitch' ) + nod * this.#nod.pitch;
		aims.yaw = sway * SPEECH_LIMITS.yaw * 0.65 * this.#wave( 'yaw' ) + nod * this.#nod.yaw;
		aims.roll = sway * SPEECH_LIMITS.roll * 0.55 * this.#wave( 'roll' ) + nod * this.#nod.roll;

	}

	/** Two slow sines of the line's own rates and phases, within -1 and 1. */
	#wave( axis ) {

		const sway = this.#sway[ axis ];
		const at = 2 * Math.PI * this.#time;
		return 0.65 * Math.sin( at * sway[ 0 ] + sway[ 1 ] ) + 0.35 * Math.sin( at * sway[ 2 ] + sway[ 3 ] );

	}

	/**
	 * Eases one axis toward its aim as a critically damped spring, stable for
	 * any step (Game Programming Gems 4, 1.10), then bounds it softly.
	 */
	#follow( axis, step ) {

		const omega = 2 / FOLLOW;
		const x = omega * step;
		const decay = 1 / ( 1 + x + 0.48 * x * x + 0.235 * x * x * x );
		const change = this.#springs[ axis ] - this.#aims[ axis ];
		const pull = ( this.#velocity[ axis ] + omega * change ) * step;
		this.#velocity[ axis ] = ( this.#velocity[ axis ] - omega * pull ) * decay;
		this.#springs[ axis ] = this.#aims[ axis ] + ( change + pull ) * decay;
		const limit = SPEECH_LIMITS[ axis ];
		this.angles[ axis ] = limit * Math.tanh( this.#springs[ axis ] / limit );

	}

	/** Whether every axis is within REST of the clip's pose. */
	#still() {

		for ( const axis of AXES ) if ( Math.abs( this.angles[ axis ] ) >= REST ) return false;
		return true;

	}

	/** At rest: nothing left turning or heard, the clip's pose left alone, and the next line starts as if it were the first. */
	#settle() {

		for ( const axis of AXES ) this.angles[ axis ] = this.#springs[ axis ] = this.#velocity[ axis ] = 0;
		this.#presence = this.#envelope = this.#drive = this.#mean = 0;
		this.#loudest = LOUDEST_FLOOR;
		this.#nod.time = NOD_GAP;

	}

	#apply() {

		const { pitch, yaw, roll } = this.angles;
		for ( const joint of this.#joints ) {

			joint.pose.copy( joint.bone.quaternion );
			turn.setFromAxisAngle( joint.yaw, yaw * joint.share );
			turn.multiply( part.setFromAxisAngle( joint.pitch, pitch * joint.share ) );
			turn.multiply( part.setFromAxisAngle( joint.roll, roll * joint.share ) );
			joint.bone.quaternion.multiply( turn );

		}
		this.#applied = true;

	}

}

/** The share of the way a follower of `seconds` covers in `step`. */
function ease( step, seconds ) {

	return 1 - Math.exp( - step / seconds );

}

function smoothstep( value ) {

	const t = Math.min( 1, Math.max( 0, value ) );
	return t * t * ( 3 - 2 * t );

}

/** mulberry32: numbers in [0, 1) that `seed` alone decides. */
function random( seed ) {

	let state = seed >>> 0;
	return () => {

		state = ( state + 0x6d2b79f5 ) >>> 0;
		let value = Math.imul( state ^ ( state >>> 15 ), 1 | state );
		value = ( value + Math.imul( value ^ ( value >>> 7 ), 61 | value ) ) ^ value;
		return ( ( value ^ ( value >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}
