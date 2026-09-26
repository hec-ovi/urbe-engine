import { PcmStreamDecoder } from './PcmStreamDecoder.js';
import { VoiceCache } from './VoiceCache.js';
import { VoiceClient } from './VoiceClient.js';
import { VoicePlayer } from './VoicePlayer.js';

/** The longest text Voice speaks in one request; a longer line is spoken in pieces. */
const MAX_TEXT = 1200;
/** Characters a second at the slow end of measured NPC speech: a line's expected length. */
const CHARS_PER_SECOND = 10;
/** Voice reads at most this much of a persona (voice/CONTRACT.md speaker). */
const PERSONA_MAX = 4000;
/** Once Voice is found unavailable it is asked again no sooner than this. */
const RECHECK_MS = 30000;
/** Voice queues at most this many prefetched lines. */
const PREFETCH_MAX = 8;
const GENDERS = new Set( [ 'male', 'female' ] );
/** A line with a letter or digit outside its [cue] tags has something to say. */
const SPOKEN = /[\p{L}\p{N}]/u;
const CUE_TAGS = /\[[^\]]*\]/g;

/**
 * Speaks NPC lines as GameApp's line observer (game/CONTRACT.md): each line
 * it hears is queued, fetched from /api/voice one at a time and played in
 * order, so one person speaks at a time and never over themselves. The text
 * is already on screen; the audio follows. A streamed line starts once enough
 * has arrived to play through (VoicePlayer). `silenced()` stops the audio and
 * drops the queue. A person without identity, age or gender is not voiced.
 * Voice being off, down or failing leaves the conversation silent and
 * otherwise untouched.
 */
export class NpcVoice {

	/** Utterances queued, loading or playing. */
	#utterances = new Set();
	/** The last queued utterance's playback end: the next one starts after it. */
	#tail = null;
	/** Downloads run one at a time, in queue order, as Voice renders them. */
	#loading = Promise.resolve();
	#checking = null;
	#retryAt = 0;
	/** Utterances still to finish per chat line, which is marked speaking until none are left. */
	#lines = new Map();

	/**
	 * @param options.dialog the ChatPanel whose lines are marked while they are voiced
	 * @param options.types the world's NPC type definitions ({ type, category, label }), for the speaker's category and label
	 * @param options.persona npcId -> the quest role persona the person is cast in, or null
	 * @param options.hold (conversation, seconds) keeps the person speaking that much longer, while their audio plays
	 */
	constructor( {
		dialog, types = [], persona = () => null, hold = () => {}, enabled = true, volume = 1,
		client = new VoiceClient(), player = new VoicePlayer(), cache = new VoiceCache(), now = () => Date.now()
	} ) {

		Object.assign( this, { dialog, persona, hold, enabled, client, player, cache, now } );
		this.types = new Map( types.map( ( type ) => [ type.type, type ] ) );
		/** Voice's status as last asked: `unknown` until the first line. */
		this.status = 'unknown';
		/** The prefetch group this session's batches replace each other in. */
		this.group = `dialogue-${Math.random().toString( 36 ).slice( 2, 10 )}`;
		this.stats = { requested: 0, started: 0, played: 0, bytes: 0, cached: 0, failed: 0, error: null };
		this.setVolume( volume );

	}

	/** Line observer: queues `text` in the voice of the conversation's person; a line of cues alone stays silent. */
	said( { conversation, line, text } ) {

		const speaker = this.#speaker( conversation );
		if ( ! speaker || ! SPOKEN.test( text.replace( CUE_TAGS, '' ) ) ) return;
		for ( const piece of pieces( text ) ) this.#queue( { conversation, line, speaker, text: piece } );

	}

	/** Line observer: stops what is playing and drops what is queued. */
	silenced() {

		for ( const utterance of this.#utterances ) {

			utterance.controller.abort();
			utterance.playback.stop();

		}
		this.#utterances.clear();
		this.#tail = null;

	}

	/**
	 * Line observer: lines the player may hear next from this person, rendered
	 * ahead so they play at once. The host sends them only while no typed reply
	 * is pending, so they never compete with the dialogue model.
	 */
	async upcoming( { conversation, texts } ) {

		const speaker = this.#speaker( conversation );
		if ( ! speaker ) return;
		const items = texts.flatMap( ( text ) => pieces( text ) ).filter( ( text ) => ! this.cache.has( keyOf( speaker, text ) ) )
			.slice( 0, PREFETCH_MAX ).map( ( text ) => ( { text, speaker } ) );
		if ( ! items.length || ! ( await this.#available() ) ) return;
		await this.client.prefetch( this.group, items ).catch( ( error ) => console.warn( 'voice prefetch:', error.message ) );

	}

	setEnabled( enabled ) {

		this.enabled = enabled;
		if ( ! enabled ) this.silenced();

	}

	/** 0 to 1. */
	setVolume( volume ) {

		this.volume = volume;
		this.player.setVolume( volume );

	}

	/** What the voice has done this session, for diagnostics. */
	report() {

		return { enabled: this.enabled, status: this.status, queued: this.#utterances.size, ...this.stats };

	}

	/** The person's speaker, or null when there is nothing to voice them with now. */
	#speaker( conversation ) {

		if ( ! this.enabled || ! this.player.supported || this.now() < this.#retryAt ) return null;
		return speakerOf( conversation?.instance, this.types, this.persona );

	}

	#queue( { conversation, line, speaker, text } ) {

		const utterance = { speaker, text, controller: new AbortController() };
		this.#mark( line, 1 );
		utterance.playback = this.player.play( {
			estimate: text.length / CHARS_PER_SECOND,
			after: this.#tail,
			onStart: () => {

				this.stats.started ++;
				this.dialog.setSpeaking( line, 'playing' );

			},
			onAhead: ( seconds ) => this.hold( conversation, seconds )
		} );
		this.#tail = utterance.playback.done;
		this.#utterances.add( utterance );
		utterance.playback.done.then( () => {

			if ( utterance.playback.started && ! utterance.controller.signal.aborted ) this.stats.played ++;
			this.#utterances.delete( utterance );
			this.#mark( line, - 1 );

		} );
		this.#loading = this.#loading.then( () => this.#load( utterance ) ).catch( ( error ) => console.error( 'voice:', error ) );

	}

	/** Feeds one utterance's playback from the session cache or from Voice; a line that breaks off plays what came and is not kept. */
	async #load( { speaker, text, controller, playback } ) {

		const key = keyOf( speaker, text );
		const cached = this.cache.get( key );
		if ( cached ) {

			this.stats.cached ++;
			playback.push( cached );
			return playback.end();

		}
		try {

			if ( controller.signal.aborted || ! ( await this.#available() ) || ! ( await this.player.ready() ) ) return;
			this.stats.requested ++;
			const response = await this.client.speak( { text, speaker }, { signal: controller.signal } );
			const decoder = new PcmStreamDecoder();
			const whole = [];
			const reader = response.body.getReader();
			for ( let read = await reader.read(); ! read.done; read = await reader.read() ) {

				this.stats.bytes += read.value.length;
				const samples = decoder.push( read.value );
				whole.push( samples );
				playback.push( samples );

			}
			this.cache.set( key, joined( whole ) );

		} catch ( error ) {

			if ( controller.signal.aborted ) return;
			this.stats.failed ++;
			this.stats.error = error.message;
			if ( error.status === 503 ) this.#unavailable( error.code === 'E_LOADING' ? 'loading' : 'unreachable' );
			console.warn( 'voice:', error.message );

		} finally {

			playback.end();

		}

	}

	/** Whether Voice speaks now, asking the server at most once per RECHECK_MS while it does not. */
	#available() {

		if ( this.status === 'ok' ) return Promise.resolve( true );
		if ( this.now() < this.#retryAt ) return Promise.resolve( false );
		return this.#checking ??= this.client.capability().then( ( { status } ) => {

			this.#checking = null;
			if ( status === 'ok' ) this.status = status;
			else this.#unavailable( status );
			return status === 'ok';

		} );

	}

	#unavailable( status ) {

		this.status = status;
		this.#retryAt = this.now() + RECHECK_MS;

	}

	/** Marks a chat line pending while it has utterances and idle once the last one ends. */
	#mark( line, change ) {

		const left = ( this.#lines.get( line ) ?? 0 ) + change;
		if ( left > 0 ) this.#lines.set( line, left );
		else this.#lines.delete( line );
		if ( change > 0 && left === 1 ) this.dialog.setSpeaking( line, 'pending' );
		if ( left === 0 ) this.dialog.setSpeaking( line, 'idle' );

	}

}

/**
 * The Voice speaker for a Simulation NPC instance, or null when it lacks the
 * identity, gender or age a voice is designed from. Category and label come
 * from the world's type set; the persona of the quest role it plays, when it
 * is cast, shapes the voice too.
 */
export function speakerOf( instance, types, persona ) {

	if ( ! instance?.npcId || ! GENDERS.has( instance.gender ) || ! Number.isInteger( instance.age ) ) return null;
	const type = types.get( instance.type );
	const role = persona( instance.npcId );
	return {
		id: instance.npcId, gender: instance.gender, age: instance.age, traits: instance.traits ?? [],
		...( type ? { category: type.category, label: type.label } : {} ),
		...( role ? { persona: role.slice( 0, PERSONA_MAX ) } : {} )
	};

}

/** `text` in pieces Voice takes whole, cut after a sentence where one ends in time, else between words. */
export function pieces( text, max = MAX_TEXT ) {

	const cuts = [];
	let rest = text.trim();
	while ( rest.length > max ) {

		const head = rest.slice( 0, max + 1 );
		const sentence = Math.max( ...[ '. ', '! ', '? ' ].map( ( end ) => head.lastIndexOf( end ) ) );
		const at = sentence > 0 ? sentence + 1 : head.lastIndexOf( ' ' ) > 0 ? head.lastIndexOf( ' ' ) : max;
		cuts.push( rest.slice( 0, at ).trim() );
		rest = rest.slice( at ).trim();

	}
	if ( rest ) cuts.push( rest );
	return cuts;

}

/** A speaker's facts are fixed for the session, so the person and the text name their audio. */
function keyOf( speaker, text ) {

	return `${speaker.id}\u001f${text}`;

}

function joined( pieces ) {

	const samples = new Float32Array( pieces.reduce( ( length, piece ) => length + piece.length, 0 ) );
	let at = 0;
	for ( const piece of pieces ) {

		samples.set( piece, at );
		at += piece.length;

	}
	return samples;

}
