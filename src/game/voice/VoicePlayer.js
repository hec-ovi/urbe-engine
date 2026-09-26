import { SAMPLE_RATE } from './PcmStreamDecoder.js';

/** Audio is scheduled this far ahead of the clock, so no buffer starts late. */
const LEAD = 0.05;
/** While a line plays, arriving samples are scheduled in pieces of at least this many (about 85 ms). */
const PIECE = 2048;
/** A line never starts with less than this many seconds buffered, unless it has all arrived. */
const MIN_BUFFER = 0.3;
/** Seconds held back against unevenly arriving audio. */
const MARGIN = 0.25;
/**
 * Seconds of audio that arrive per second before any line has shown the real
 * rate, weighted as this many seconds seen: Voice renders at about 1.1 to 1.7
 * times real time on the shared GPU.
 */
const PRIOR_RATE = 0.8;
const PRIOR_SECONDS = 1;
/** A line that took less than this to arrive says little about the render rate. */
const LEARN_SECONDS = 1;
/** How long asking the audio clock to run may take. */
const RESUME_MS = 400;

/**
 * Web Audio output for NPC lines: one AudioContext and volume, and a
 * Playback per line. Browsers only let audio run after a key or pointer
 * press, so `unlockOn` asks for it on every press until it runs.
 */
export class VoicePlayer {

	#context = null;
	#output = null;
	#volume = 1;
	/** Seconds of audio per second of arrival, learned from the lines that arrived whole. */
	rate = PRIOR_RATE;

	constructor( { AudioContextClass = globalThis.AudioContext, now = () => performance.now() } = {} ) {

		this.AudioContextClass = AudioContextClass;
		this.now = now;

	}

	get supported() {

		return Boolean( this.AudioContextClass );

	}

	get context() {

		if ( ! this.#context ) {

			this.#context = new this.AudioContextClass();
			this.#output = this.#context.createGain();
			this.#output.gain.value = this.#volume;
			this.#output.connect( this.#context.destination );

		}
		return this.#context;

	}

	/** Where every line's audio goes: the volume. */
	get output() {

		return this.context && this.#output;

	}

	unlockOn( target ) {

		if ( ! this.supported ) return;
		const unlock = () => this.context.state === 'running' || this.context.resume().catch( () => {} );
		for ( const type of [ 'keydown', 'pointerdown' ] ) target.addEventListener( type, unlock, { capture: true } );

	}

	/** 0 to 1. */
	setVolume( volume ) {

		this.#volume = volume;
		if ( this.#output ) this.#output.gain.value = volume;

	}

	/** Whether the audio clock runs once asked to; false while the browser still holds audio back. */
	async ready() {

		if ( ! this.supported ) return false;
		const context = this.context;
		if ( context.state !== 'running' ) {

			await Promise.race( [ context.resume().catch( () => {} ), new Promise( ( resolve ) => setTimeout( resolve, RESUME_MS ) ) ] );

		}
		return context.state === 'running';

	}

	/**
	 * A new line's playback. `estimate` is its expected length in seconds,
	 * `after` a promise it waits for before starting (the line before it),
	 * `onStart()` fires when its first audio is scheduled and `onAhead(seconds)`
	 * each time more is, with how much is now scheduled ahead of the clock.
	 */
	play( options ) {

		return new Playback( this, options );

	}

	/** Folds a whole line's arrival rate into the one the next line starts from. */
	learn( rate ) {

		this.rate = ( this.rate + Math.min( 4, Math.max( 0.1, rate ) ) ) / 2;

	}

}

/**
 * One line's audio. Samples are pushed as they arrive and play back to back
 * on the audio clock. Before it starts, and again after it runs dry, it waits
 * until what is buffered covers the part of the rest that would arrive late
 * at the rate seen so far: the line's remaining length times the share by
 * which arrival is slower than real time, plus a margin. A line that has all
 * arrived starts at once. `done` settles when its audio has played or it stops.
 */
class Playback {

	#player;
	#estimate;
	#onStart;
	#onAhead;
	#finish;
	#pending = [];
	#pendingLength = 0;
	#received = 0;
	#scheduled = 0;
	/** When the first samples arrived and how many, and when the latest did: the arrival rate. */
	#first = null;
	#firstLength = 0;
	#latest = 0;
	#sources = new Set();
	/** Audio-clock time the scheduled audio runs to. */
	#end = 0;
	#playing = false;
	#open = false;
	#ended = false;
	#stopped = false;
	started = false;

	constructor( player, { estimate = 0, after = null, onStart = () => {}, onAhead = () => {} } = {} ) {

		this.#player = player;
		this.#estimate = estimate;
		this.#onStart = onStart;
		this.#onAhead = onAhead;
		this.done = new Promise( ( resolve ) => this.#finish = resolve );
		Promise.resolve( after ).then( () => {

			this.#open = true;
			this.#pump();

		} );

	}

	push( samples ) {

		if ( this.#stopped || this.#ended || ! samples.length ) return;
		this.#latest = this.#player.now();
		if ( this.#first === null ) {

			this.#first = this.#latest;
			this.#firstLength = samples.length;

		}
		this.#received += samples.length;
		this.#pending.push( samples );
		this.#pendingLength += samples.length;
		this.#pump();

	}

	/** Every sample has arrived. */
	end() {

		if ( this.#ended || this.#stopped ) return;
		this.#ended = true;
		const seconds = ( this.#latest - this.#first ) / 1000;
		if ( seconds >= LEARN_SECONDS ) this.#player.learn( ( this.#received - this.#firstLength ) / SAMPLE_RATE / seconds );
		this.#pump();

	}

	stop() {

		if ( this.#stopped ) return;
		this.#stopped = true;
		for ( const source of this.#sources ) {

			source.onended = null;
			source.stop();
			source.disconnect();

		}
		this.#sources.clear();
		this.#pending = [];
		this.#pendingLength = 0;
		this.#finish();

	}

	#pump() {

		if ( this.#stopped || ! this.#open ) return;
		const context = this.#player.context;
		if ( this.#playing && this.#end < context.currentTime + LEAD ) this.#playing = false;
		if ( ! this.#playing ) {

			if ( ! this.#pendingLength ) return this.#settle();
			if ( ! this.#ended && this.#pendingLength / SAMPLE_RATE < this.#need() ) return;
			this.#playing = true;
			this.#end = context.currentTime + LEAD;
			if ( ! this.started ) {

				this.started = true;
				this.#onStart();

			}

		}
		if ( this.#pendingLength >= PIECE || ( this.#ended && this.#pendingLength ) ) this.#schedule( context );
		this.#settle();

	}

	/** Seconds to buffer before playing on: see the class. */
	#need() {

		const left = Math.max( this.#estimate, this.#received / SAMPLE_RATE ) - this.#scheduled / SAMPLE_RATE;
		return Math.min( left, Math.max( MIN_BUFFER, left * ( 1 - Math.min( 1, this.#rate() ) ) + MARGIN ) );

	}

	/** Seconds of audio arriving per second, this line's own arrival weighed against the player's learned rate. */
	#rate() {

		if ( this.#first === null ) return this.#player.rate;
		const seconds = ( this.#player.now() - this.#first ) / 1000;
		const audio = ( this.#received - this.#firstLength ) / SAMPLE_RATE;
		return ( this.#player.rate * PRIOR_SECONDS + audio ) / ( PRIOR_SECONDS + seconds );

	}

	#schedule( context ) {

		const samples = new Float32Array( this.#pendingLength );
		let at = 0;
		for ( const piece of this.#pending ) {

			samples.set( piece, at );
			at += piece.length;

		}
		this.#pending = [];
		this.#pendingLength = 0;
		const buffer = context.createBuffer( 1, samples.length, SAMPLE_RATE );
		buffer.copyToChannel( samples, 0 );
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect( this.#player.output );
		source.onended = () => {

			this.#sources.delete( source );
			this.#pump();

		};
		source.start( this.#end );
		this.#sources.add( source );
		this.#end += samples.length / SAMPLE_RATE;
		this.#scheduled += samples.length;
		this.#onAhead( this.#end - context.currentTime );

	}

	#settle() {

		if ( this.#ended && ! this.#pendingLength && ! this.#sources.size ) this.#finish();

	}

}
