import { describe, expect, it, vi } from 'vitest';
import { VoicePlayer } from './VoicePlayer.js';
import { FakeAudioContext, audio } from './voice.test-fixtures.js';

/** A player on a fake audio context and a wall clock the test sets (milliseconds). */
function rig() {

	const clock = { ms: 0 };
	let context = null;
	const player = new VoicePlayer( {
		AudioContextClass: class { constructor() { return context = new FakeAudioContext(); } },
		now: () => clock.ms
	} );
	return { player, clock, context: () => player.context && context };

}

const settled = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

describe( 'VoicePlayer', () => {

	it( 'buffers before starting what the arrival rate says the rest would lack, less for a line arriving faster than it plays', async () => {

		const slow = rig();
		const line = slow.player.play( { estimate: 4 } );
		await settled();
		line.push( audio( 0.5 ) );
		slow.clock.ms = 625;
		line.push( audio( 0.5 ) );
		expect( line.started ).toBe( false );
		slow.clock.ms = 750;
		line.push( audio( 0.1 ) );
		expect( line.started ).toBe( true );
		expect( slow.context().sources[ 0 ].at ).toBe( 0.05 );

		const fast = rig();
		const quick = fast.player.play( { estimate: 4 } );
		await settled();
		for ( const ms of [ 0, 125, 250 ] ) {

			fast.clock.ms = ms;
			quick.push( audio( 0.25 ) );

		}
		expect( quick.started ).toBe( true );

		const learned = rig();
		const first = learned.player.play( { estimate: 2 } );
		first.push( audio( 0.1 ) );
		learned.clock.ms = 4000;
		first.push( audio( 2 ) );
		first.end();
		expect( learned.player.rate ).toBeCloseTo( 0.65 );

	} );

	it( 'plays pieces back to back, and after running dry buffers again before going on', async () => {

		const { player, clock, context } = rig();
		const line = player.play( { estimate: 3 } );
		await settled();
		line.push( audio( 1 ) );
		line.push( audio( 0.5 ) );
		const [ first, second ] = context().sources;
		expect( [ first.at, second.at ] ).toEqual( [ 0.05, 1.05 ] );

		context().advance( 1.6 );
		clock.ms = 2000;
		line.push( audio( 0.1 ) );
		expect( context().sources ).toHaveLength( 2 );
		line.push( audio( 1 ) );
		expect( context().sources ).toHaveLength( 3 );
		expect( context().sources[ 2 ].at ).toBeCloseTo( 1.65 );

	} );

	it( 'starts a line that has all arrived at once, after the line before it, and is done when its audio has played', async () => {

		const { player, context } = rig();
		const onStart = vi.fn();
		const onAhead = vi.fn();
		const first = player.play( { estimate: 10 } );
		const second = player.play( { estimate: 10, after: first.done, onStart, onAhead } );
		second.push( audio( 0.2 ) );
		second.end();
		first.push( audio( 0.1 ) );
		first.end();
		await settled();
		expect( context().sources ).toHaveLength( 1 );
		expect( onStart ).not.toHaveBeenCalled();

		let done = false;
		second.done.then( () => done = true );
		context().advance( 0.2 );
		await settled();
		expect( onStart ).toHaveBeenCalledOnce();
		expect( onAhead ).toHaveBeenCalledWith( expect.closeTo( 0.25 ) );
		expect( context().sources[ 1 ].at ).toBeCloseTo( 0.25 );
		expect( done ).toBe( false );
		context().advance( 0.3 );
		await settled();
		expect( done ).toBe( true );

	} );

	it( 'stops at once, silencing what is scheduled and ignoring what arrives after', async () => {

		const { player, context } = rig();
		const line = player.play( { estimate: 0.5 } );
		await settled();
		line.push( audio( 0.5 ) );
		const [ source ] = context().sources;
		line.stop();
		await line.done;
		expect( source.stop ).toHaveBeenCalledOnce();
		expect( source.disconnect ).toHaveBeenCalledOnce();
		line.push( audio( 1 ) );
		line.end();
		expect( context().sources ).toHaveLength( 1 );

	} );

	it( 'sets the volume on its output and runs the audio clock only once the browser allows it', async () => {

		const { player, context } = rig();
		player.setVolume( 0.4 );
		expect( context().gains[ 0 ].gain.value ).toBe( 0.4 );
		player.setVolume( 0.7 );
		expect( context().gains[ 0 ].gain.value ).toBe( 0.7 );

		context().state = 'suspended';
		context().resume = () => Promise.resolve();
		expect( await player.ready() ).toBe( false );
		const target = new EventTarget();
		let wanted = false;
		context().resume = vi.fn( () => { context().state = 'running'; return Promise.resolve(); } );
		player.unlockOn( target, () => wanted );
		target.dispatchEvent( new Event( 'keydown' ) );
		expect( context().resume ).not.toHaveBeenCalled();
		wanted = true;
		target.dispatchEvent( new Event( 'keydown' ) );
		expect( context().resume ).toHaveBeenCalledOnce();
		expect( await player.ready() ).toBe( true );
		context().state = 'suspended';
		target.dispatchEvent( new Event( 'pointerdown' ) );
		expect( context().resume ).toHaveBeenCalledOnce();

		player.resume();
		expect( context().resume ).toHaveBeenCalledTimes( 2 );
		player.suspend();
		await settled();
		expect( context().state ).toBe( 'suspended' );

		expect( await new VoicePlayer( { AudioContextClass: undefined } ).ready() ).toBe( false );

	} );

	it( 'stops the clock where it is while paused, starts no line and runs on after, unless voice was turned off meanwhile', async () => {

		const { player, context } = rig();
		expect( await player.ready() ).toBe( true );
		player.setPaused( true );
		await settled();
		expect( context().state ).toBe( 'suspended' );
		let ready = null;
		player.ready().then( ( value ) => { ready = value; } );
		player.resume();
		await settled();
		expect( context().state ).toBe( 'suspended' );
		expect( ready ).toBeNull();
		player.setPaused( false );
		await settled();
		expect( context().state ).toBe( 'running' );
		expect( ready ).toBe( true );

		player.setPaused( true );
		player.suspend();
		player.setPaused( false );
		await settled();
		expect( context().state ).toBe( 'suspended' );

	} );

	it( 'measures the loudness of what the lines play before the volume, in one buffer for the session', async () => {

		const { player, context } = rig();
		expect( player.loudness() ).toBe( 0 );
		const line = player.play( { estimate: 0.5 } );
		await settled();
		line.push( audio( 0.5 ) );
		const [ analyser ] = context().analysers;
		const [ gain ] = context().gains;
		expect( context().sources[ 0 ].connect ).toHaveBeenCalledWith( analyser );
		expect( analyser.connect ).toHaveBeenCalledWith( gain );
		expect( gain.connect ).toHaveBeenCalledWith( context().destination );
		expect( player.loudness() ).toBe( 0 );

		// A sine of amplitude 0.5 over whole periods: its RMS is 0.5 / sqrt(2), whatever the volume.
		analyser.wave = ( i ) => 0.5 * Math.sin( 2 * Math.PI * i / 64 );
		player.setVolume( 0.1 );
		expect( player.loudness() ).toBeCloseTo( 0.5 / Math.SQRT2, 6 );
		analyser.wave = ( i ) => ( i % 2 ? 0.2 : - 0.2 );
		expect( player.loudness() ).toBeCloseTo( 0.2, 6 );
		const [ [ first ], [ second ] ] = analyser.getFloatTimeDomainData.mock.calls.slice( - 2 );
		expect( second ).toBe( first );
		expect( first ).toHaveLength( analyser.fftSize );

	} );

	it( 'makes no audio clock for a press while it is not wanted, nor to rest or run one, and stops listening once one runs', () => {

		const contexts = [];
		const player = new VoicePlayer( { AudioContextClass: class { constructor() { contexts.push( this ); } } } );
		const target = new EventTarget();
		player.unlockOn( target, () => false );
		target.dispatchEvent( new Event( 'keydown' ) );
		player.suspend();
		player.resume();
		expect( contexts ).toHaveLength( 0 );

		const running = rig();
		const wanted = vi.fn( () => true );
		running.player.unlockOn( target, wanted );
		target.dispatchEvent( new Event( 'keydown' ) );
		target.dispatchEvent( new Event( 'pointerdown' ) );
		expect( wanted ).toHaveBeenCalledOnce();

	} );

} );
