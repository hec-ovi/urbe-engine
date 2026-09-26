import { DEFAULT_TYPE_SET } from '../../../../simulation/dist/index.js';
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
/** Lines failing in a row with 502, or breaking off after their audio started (Voice answers, its model server does not), before Voice is rested like a 503. */
const UPSTREAM_FAILURES = 2;
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
 * drops the queue and the lines rendered ahead, except those said along with
 * it, as a chosen reply is. A person without identity,
 * age or gender is not voiced. Lines the player may hear next are rendered
 * ahead once the lines said before them have loaded. Voice being off, down
 * or failing leaves the conversation silent and otherwise untouched.
 */
export class NpcVoice {

	/** Utterances queued, loading or playing. */
	#utterances = new Set();
	/** The last queued utterance's playback end: the next one starts after it. */
	#tail = null;
	/** Downloads run one at a time, in queue order, as Voice renders them; prefetches wait their turn in it too. */
	#loading = Promise.resolve();
	/** Counts silences: a prefetch asked for before the latest one is dropped unsent. */
	#silences = 0;
	/** Requests on the prefetch group, each sent once the one before is answered, so Voice sees them in order. */
	#groupRequests = Promise.resolve();
	/** Whether a batch went out since the last silence, so Voice may hold lines of the group. */
	#batched = false;
	#checking = null;
	#retryAt = 0;
	/** Lines failed in a row with 502 or broken off. */
	#upstreamFailures = 0;
	/** Utterances still to finish per chat line, which is marked speaking until none are left. */
	#lines = new Map();
	/** Where a line's speech reads its loudness: the one player every line plays through. */
	#loudness = () => this.player.loudness();

	/**
	 * @param options.dialog the ChatPanel whose lines are marked while they are voiced
	 * @param options.types the world's NPC type definitions ({ type, category, label }), for the speaker's category and label
	 * @param options.persona npcId -> the quest role persona the person is cast in, or null
	 * @param options.hold (conversation, seconds) keeps the person speaking that much longer, while their audio plays
	 * @param options.speaking (conversation, speech) hears each line's audio start, with its speech, and end, with null
	 */
	constructor( {
		dialog, types = [], persona = () => null, hold = () => {}, speaking = () => {}, enabled = true, volume = 1,
		client = new VoiceClient(), player = new VoicePlayer(), cache = new VoiceCache(), now = () => Date.now()
	} ) {

		Object.assign( this, { dialog, persona, hold, speaking, enabled, client, player, cache, now } );
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

	/**
	 * The game's own voice for a loaded world: speakers typed by the world's
	 * NPC type set (Simulation's default when it has none), cast personas
	 * from `quests`, and the person kept talking by `animations` while their
	 * audio plays, moving to it. The audio clock unlocks on a press on
	 * `target` while voice is on. Other options go to the constructor.
	 */
	static forGame( { npcTypes, quests, animations, target, ...options } ) {

		const voice = new NpcVoice( {
			...options,
			types: ( npcTypes ?? DEFAULT_TYPE_SET ).types,
			persona: ( npcId ) => quests.persona( npcId ),
			hold: ( conversation, seconds ) => animations.holdDialogueTurn( conversation, seconds ),
			speaking: ( conversation, speech ) => animations.speaking( conversation, speech )
		} );
		voice.player.unlockOn( target, () => voice.enabled );
		return voice;

	}

	/**
	 * Line observer: stops what is playing and drops what is queued, and what
	 * is rendered ahead, sent or not. Lines said right after it in the same
	 * task, as the reply to a choice is, reach Voice before the group is
	 * cancelled, so their renders ahead go on.
	 */
	silenced() {

		this.#silences ++;
		for ( const utterance of this.#utterances ) {

			utterance.controller.abort();
			utterance.playback.stop();

		}
		this.#utterances.clear();
		this.#tail = null;
		if ( ! this.#batched ) return;
		this.#batched = false;
		queueMicrotask( () => {

			const said = [ ...this.#utterances ].map( ( utterance ) => utterance.reached.promise );
			this.#toGroup( 'cancel', () => Promise.all( said ).then( () => this.client.cancel( this.group ) ) );

		} );

	}

	/**
	 * Line observer: lines the player may hear next from this person, rendered
	 * ahead so they play at once. The host sends them only while no typed reply
	 * is pending, so they never compete with the dialogue model. They go to
	 * Voice once the lines said before them have loaded, so those render first,
	 * and not at all if the conversation was silenced meanwhile.
	 */
	upcoming( { conversation, texts } ) {

		const speaker = this.#speaker( conversation );
		if ( ! speaker ) return;
		const silences = this.#silences;
		return this.#next( () => this.#prefetch( speaker, texts, silences ) );

	}

	/** Off stops the voice and rests the audio clock; on, from the settings, lets it run again. */
	setEnabled( enabled ) {

		this.enabled = enabled;
		if ( enabled ) this.player.resume();
		else {

			this.silenced();
			this.player.suspend();

		}

	}

	/** Paused, what is playing stops where it is and no line starts; unpaused, both go on. */
	setPaused( paused ) {

		this.player.setPaused( paused );

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

		const key = keyOf( speaker, text );
		const utterance = { speaker, text, key, controller: new AbortController(), reached: Promise.withResolvers() };
		this.#mark( line, 1 );
		utterance.playback = this.player.play( {
			estimate: text.length / CHARS_PER_SECOND,
			after: this.#tail,
			onStart: () => {

				this.stats.started ++;
				this.dialog.setSpeaking( line, 'playing' );
				this.speaking( conversation, { seed: seedOf( key ), loudness: this.#loudness } );

			},
			onAhead: ( seconds ) => this.hold( conversation, seconds )
		} );
		this.#tail = utterance.playback.done;
		this.#utterances.add( utterance );
		utterance.playback.done.then( () => {

			const { started } = utterance.playback;
			if ( started && ! utterance.failed && ! utterance.controller.signal.aborted ) this.stats.played ++;
			this.#utterances.delete( utterance );
			this.#mark( line, - 1 );
			if ( started ) this.speaking( conversation, null );

		} );
		this.#next( () => this.#load( utterance ) );

	}

	/** Runs `step` once the downloads and prefetches queued before it are through. */
	#next( step ) {

		return this.#loading = this.#loading.then( step ).catch( ( error ) => console.error( 'voice:', error ) );

	}

	/**
	 * Feeds one utterance's playback from the session cache or from Voice. A
	 * line that breaks off plays what came, counts as failed, not played, and
	 * is not kept. `reached` resolves once Voice answers, or once it will not
	 * be asked.
	 */
	async #load( utterance ) {

		const { speaker, text, key, controller, playback, reached } = utterance;
		let answered = false;
		try {

			const cached = this.cache.get( key );
			if ( controller.signal.aborted || ! ( cached || await this.#available() ) || ! ( await this.player.ready() ) ) return;
			if ( cached ) {

				this.stats.cached ++;
				return playback.push( cached );

			}
			this.stats.requested ++;
			const response = await this.client.speak( { text, speaker }, { signal: controller.signal } );
			answered = true;
			reached.resolve();
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
			this.#upstreamFailures = 0;

		} catch ( error ) {

			if ( controller.signal.aborted ) return;
			utterance.failed = true;
			this.stats.failed ++;
			this.stats.error = error.message;
			if ( error.status === 503 ) this.#unavailable( error.code === 'E_LOADING' ? 'loading' : 'unreachable' );
			else if ( ( error.status === 502 || answered ) && ++ this.#upstreamFailures >= UPSTREAM_FAILURES ) this.#unavailable( 'degraded' );
			console.warn( 'voice:', error.message );

		} finally {

			reached.resolve();
			playback.end();

		}

	}

	/** Sends the lines not heard yet, at most a batch, as this session's prefetch group, unless silenced since `silences`. */
	async #prefetch( speaker, texts, silences ) {

		const items = texts.flatMap( ( text ) => pieces( text ) ).filter( ( text ) => ! this.cache.has( keyOf( speaker, text ) ) )
			.slice( 0, PREFETCH_MAX ).map( ( text ) => ( { text, speaker } ) );
		if ( ! items.length || ! ( await this.#available() ) || silences !== this.#silences ) return;
		this.#batched = true;
		this.#toGroup( 'prefetch', () => this.client.prefetch( this.group, items ) );

	}

	/** Sends a request on the prefetch group once the one before it is answered; a failure is logged. */
	#toGroup( what, send ) {

		this.#groupRequests = this.#groupRequests.then( send ).catch( ( error ) => console.warn( `voice ${what}:`, error.message ) );

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
		this.#upstreamFailures = 0;

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

/** A line's own 32-bit number (FNV-1a of its key): the same person saying the same words moves the same way. */
function seedOf( key ) {

	let hash = 2166136261;
	for ( let i = 0; i < key.length; i ++ ) hash = Math.imul( hash ^ key.charCodeAt( i ), 16777619 );
	return hash >>> 0;

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
