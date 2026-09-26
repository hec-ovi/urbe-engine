import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { SPEECH_LIMITS, SpeechGesture } from './SpeechGesture.js';

const FRAME = 1 / 60;
const DEGREE = Math.PI / 180;
const AXES = [ 'pitch', 'yaw', 'roll' ];
/** The head's turn from the clip's pose never passes the three limits together. */
const BOUND = Math.hypot( SPEECH_LIMITS.pitch, SPEECH_LIMITS.yaw, SPEECH_LIMITS.roll );

/** Pelvis, spine, neck and head as the pack stands them: the neck leaning forward, the head back up, the body turned 1.2 rad. */
function body() {

	const root = new THREE.Group();
	root.rotation.y = 1.2;
	let parent = root;
	for ( const [ name, height, lean ] of [ [ 'pelvis', 0.95, 0 ], [ 'spine_03', 0.4, - 0.12 ], [ 'neck_01', 0.2, 0.52 ], [ 'Head', 0.08, - 0.27 ] ] ) {

		const bone = new THREE.Bone();
		bone.name = name;
		bone.position.y = height;
		bone.rotation.x = lean;
		parent.add( bone );
		parent = bone;

	}
	return root;

}

/** The clip's pose of the neck and head at `time`, a slow sway of its own, as the mixer writes it. */
function clipPose( root, time ) {

	root.getObjectByName( 'neck_01' ).rotation.set( 0.52 + 0.02 * Math.sin( time ), 0.03 * Math.sin( 0.7 * time ), 0 );
	root.getObjectByName( 'Head' ).rotation.set( - 0.27, 0.02 * Math.cos( time ), 0 );

}

/** Speech-like loudness: four syllables a second, a louder word each 1.3 s and a breath each 3 s. */
function speechLevel( time ) {

	if ( time % 3 > 2.6 ) return 0;
	const syllable = 0.5 + 0.5 * Math.sin( 2 * Math.PI * 4 * time );
	return 0.06 * syllable * syllable * ( time % 1.3 < 0.15 ? 2.2 : 1 );

}

/** One line: its seed and its loudness over time, read from the frame `play` is at. */
function line( seed, level = speechLevel ) {

	const speech = { seed, time: 0, loudness: () => level( speech.time ) };
	return speech;

}

/**
 * Plays `seconds` of frames from `from`: the clip poses the bones (unless it
 * holds `still`, when the mixer writes nothing), then the gesture layers over
 * it. Each frame's angles, the head's world turn and its local pose.
 */
function play( gesture, root, { from = 0, seconds, speech = null, still = false } ) {

	const head = root.getObjectByName( 'Head' );
	const frames = [];
	for ( let frame = 0; frame < Math.round( seconds / FRAME ); frame ++ ) {

		const time = from + frame * FRAME;
		gesture.rest();
		if ( ! still ) clipPose( root, time );
		if ( speech ) speech.time = time;
		gesture.update( FRAME, speech );
		frames.push( { ...gesture.angles, time, world: head.getWorldQuaternion( new THREE.Quaternion() ), local: head.quaternion.clone() } );

	}
	return frames;

}

/** The head's world turn at `time` from the clip alone. */
function clipHead( time ) {

	const root = body();
	clipPose( root, time );
	return root.getObjectByName( 'Head' ).getWorldQuaternion( new THREE.Quaternion() );

}

const most = ( values ) => values.reduce( ( top, value ) => Math.max( top, value ), - Infinity );

describe( 'speech gesture', () => {

	it( 'nods, turns and tilts the head a few degrees at most while the voice plays, smoothly, and hands it back to the clip once it stops', () => {

		const root = body();
		const gesture = new SpeechGesture( root );
		const speaking = play( gesture, root, { seconds: 20, speech: line( 11 ) } );

		for ( const axis of AXES ) {

			const values = speaking.map( ( frame ) => frame[ axis ] );
			expect( most( values.map( Math.abs ) ) ).toBeLessThan( SPEECH_LIMITS[ axis ] );
			// Seen: it covers half its reach over the line.
			expect( most( values ) - Math.min( ...values ) ).toBeGreaterThan( SPEECH_LIMITS[ axis ] / 2 );
			// Smooth: no frame turns it by a third of a degree.
			expect( most( values.slice( 1 ).map( ( value, index ) => Math.abs( value - values[ index ] ) ) ) ).toBeLessThan( DEGREE / 3 );

		}
		const turns = speaking.map( ( frame ) => frame.world.angleTo( clipHead( frame.time ) ) );
		expect( most( turns ) ).toBeLessThan( BOUND );
		expect( most( turns ) ).toBeGreaterThan( 2 * DEGREE );

		const quiet = play( gesture, root, { from: 20, seconds: 3 } );
		expect( quiet.at( - 1 ) ).toMatchObject( { pitch: 0, yaw: 0, roll: 0 } );
		expect( quiet.at( - 1 ).world.equals( clipHead( quiet.at( - 1 ).time ) ) ).toBe( true );
		expect( most( quiet.map( ( frame ) => frame.world.angleTo( clipHead( frame.time ) ) ) ) ).toBeLessThan( BOUND );

	} );

	it( 'stays within its limits however loud and sudden the speech', () => {

		// Bursts after silences, each a new loudest: a nod at every chance, over the sway and the syllables.
		const bursts = ( time ) => time % 0.9 < 0.45 ? 0 : 0.4 * ( 1 + ( Math.floor( time / 0.9 ) % 3 ) ) * ( 0.5 + 0.5 * Math.sin( 2 * Math.PI * 5 * time ) ) ** 2;
		for ( const seed of [ 1, 2, 3, 4, 5, 6, 7, 8 ] ) {

			const root = body();
			const frames = play( new SpeechGesture( root ), root, { seconds: 30, speech: line( seed, bursts ) } );
			for ( const axis of AXES ) expect( most( frames.map( ( frame ) => Math.abs( frame[ axis ] ) ) ) ).toBeLessThan( SPEECH_LIMITS[ axis ] );
			expect( most( frames.map( ( frame ) => frame.world.angleTo( clipHead( frame.time ) ) ) ) ).toBeLessThan( BOUND );

		}

	} );

	it( 'moves the same way for the same line and another way for another', () => {

		const trace = ( seed ) => {

			const root = body();
			return play( new SpeechGesture( root ), root, { seconds: 6, speech: line( seed ) } ).map( ( { pitch, yaw, roll } ) => [ pitch, yaw, roll ] );

		};
		expect( trace( 42 ) ).toEqual( trace( 42 ) );
		expect( trace( 43 ) ).not.toEqual( trace( 42 ) );

		// A line heard again once the head rests moves as it did the first time.
		const root = body();
		const gesture = new SpeechGesture( root );
		const first = play( gesture, root, { seconds: 6, speech: line( 42 ) } );
		play( gesture, root, { from: 6, seconds: 3 } );
		const again = play( gesture, root, { seconds: 6, speech: line( 42 ) } );
		expect( again.map( ( { pitch, yaw, roll } ) => [ pitch, yaw, roll ] ) ).toEqual( first.map( ( { pitch, yaw, roll } ) => [ pitch, yaw, roll ] ) );

	} );

	it( 'nods the face down on a word louder than the ones before it', () => {

		const run = ( stressed ) => {

			const root = body();
			const level = ( time ) => ( time >= 2 && time < 2.3 && stressed ? 0.1 : 0.04 ) * ( 0.5 + 0.5 * Math.sin( 2 * Math.PI * 4 * time ) ) ** 2;
			return play( new SpeechGesture( root ), root, { seconds: 3, speech: line( 5, level ) } );

		};
		const plain = run( false );
		const stressed = run( true );
		const nods = stressed.map( ( frame, index ) => frame.pitch - plain[ index ].pitch );
		expect( most( nods.slice( 0, Math.round( 2 / FRAME ) ).map( Math.abs ) ) ).toBe( 0 );
		expect( most( nods ) ).toBeGreaterThan( DEGREE );

		// Positive pitch turns the face down, about the body's own side, whichever way the body faces.
		const peak = stressed[ nods.indexOf( most( nods ) ) ];
		const forward = new THREE.Vector3( Math.sin( 1.2 ), 0, Math.cos( 1.2 ) );
		const rest = body().getObjectByName( 'Head' ).getWorldQuaternion( new THREE.Quaternion() ).invert();
		const face = ( quaternion ) => forward.clone().applyQuaternion( quaternion.clone().multiply( rest ) ).y;
		expect( face( peak.world ) ).toBeLessThan( face( plain[ nods.indexOf( most( nods ) ) ].world ) - 0.5 * DEGREE );

	} );

	it( 'never gathers turns over a clip that holds the head still, where the mixer writes nothing', () => {

		const root = body();
		const [ head, neck ] = [ root.getObjectByName( 'Head' ), root.getObjectByName( 'neck_01' ) ];
		const [ headPose, neckPose ] = [ head.quaternion.clone(), neck.quaternion.clone() ];
		const gesture = new SpeechGesture( root );
		const speaking = play( gesture, root, { seconds: 10, speech: line( 3 ), still: true } );
		expect( most( speaking.map( ( frame ) => frame.local.angleTo( headPose ) ) ) ).toBeLessThan( BOUND );
		play( gesture, root, { seconds: 3, still: true } );
		expect( head.quaternion.equals( headPose ) && neck.quaternion.equals( neckPose ) ).toBe( true );

	} );

} );
