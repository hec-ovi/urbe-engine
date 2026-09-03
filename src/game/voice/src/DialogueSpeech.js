import { LocalSpeechRuntime } from './LocalSpeechRuntime.js';
import { MicrophoneTranscriber } from './MicrophoneTranscriber.js';
import { NpcVoiceClient } from './NpcVoiceClient.js';
import { NpcVoiceError } from './NpcVoiceError.js';
import { PcmAudioPlayer } from './PcmAudioPlayer.js';

const PRESET_SHA256 = 'b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033';

/** One live dialogue port: local synthesis, playback, cancellation, and microphone STT. */
export class DialogueSpeech {

	static async connect( options = {} ) {

		const runtime = options.runtime ?? await LocalSpeechRuntime.connect( options.runtimeOptions );
		return new DialogueSpeech( { runtime, ...options } );

	}

	constructor( {
		runtime,
		client = new NpcVoiceClient( { adapter: runtime } ),
		player = new PcmAudioPlayer(),
		microphone = new MicrophoneTranscriber( runtime )
	} ) {

		this.runtime = runtime;
		this.client = client;
		this.player = player;
		this.microphone = microphone;
		this.profiles = new Map();
		this.sequence = 0;
		this.active = null;

	}

	unlock() { return this.player.unlock(); }

	async speak( conversation, text, { onPlaybackStart = () => {}, onPlaybackEnd = () => {} } = {} ) {

		this.cancel( 'replaced' );
		const generation = this.sequence;
		const npcId = conversation?.npcId ?? conversation?.instance?.npcId;
		if ( ! npcId ) throw new NpcVoiceError( 'E_VOICE_PROFILE', 'Dialogue has no stable NPC identity' );
		const profile = await this.#profile( npcId );
		if ( generation !== this.sequence ) return false;
		const requestId = `dialogue:${safeId( npcId )}:${generation}`;
		this.active = { requestId, generation, started: false, ended: false, onPlaybackEnd };
		let result;
		try {

			await this.client.start( {
				version: '1', requestId, npcId, profileDigest: profile.profileDigest,
				priority: 'conversation', content: [ { kind: 'text', text } ], delivery: {},
				inference: { seed: hash32( `${npcId}\0${text}` ), options: {} },
				outputCodecVersion: this.client.capabilities().output.codecVersion
			} );
			result = await this.client.wait( { version: '1', requestId } );

		} catch ( error ) {

			if ( generation === this.sequence ) this.active = null;
			throw error;

		}
		if ( generation !== this.sequence || result.status === 'cancelled' ) return false;
		if ( result.status !== 'completed' ) {

			this.active = null;
			throw new NpcVoiceError( result.error.code, result.error.message );

		}

		try {

			await this.player.play( result.chunks, { onStart: () => {

				if ( generation !== this.sequence || ! this.active ) return;
				this.active.started = true;
				onPlaybackStart();

			} } );

		} finally {

			if ( generation === this.sequence ) this.#finishPlayback();

		}
		return generation === this.sequence;

	}

	cancel( reason = 'stale' ) {

		this.sequence ++;
		const active = this.active;
		this.active = null;
		if ( active ) this.client.cancel( { version: '1', requestId: active.requestId, reason } );
		this.player.cancel();
		if ( active?.started && ! active.ended ) {

			active.ended = true;
			active.onPlaybackEnd();

		}

	}

	startTranscription() { return this.microphone.start(); }

	stopTranscription() { return this.microphone.stop(); }

	cancelTranscription() { this.microphone.cancel(); }

	async #profile( npcId ) {

		if ( this.profiles.has( npcId ) ) return this.profiles.get( npcId );
		const pending = this.client.registerProfile( {
			version: '1', profileId: `voice:${safeId( npcId )}`, npcId, revision: 1,
			seed: hash32( npcId ), language: 'en-US',
			delivery: { pace: 1, pitchSemitones: 0, energy: 1 },
			preset: { presetId: 'chatterbox-nano-built-in', artifactSha256: PRESET_SHA256 },
			engine: this.client.capabilities().engine,
			approvedReactions: []
		} );
		this.profiles.set( npcId, pending );
		return pending;

	}

	#finishPlayback() {

		const active = this.active;
		this.active = null;
		if ( ! active?.started || active.ended ) return;
		active.ended = true;
		active.onPlaybackEnd();

	}

}

function safeId( value ) {

	const safe = String( value ).replace( /[^A-Za-z0-9._:-]/g, '_' ).slice( 0, 100 );
	return safe && /^[A-Za-z0-9]/.test( safe ) ? safe : `npc:${hash32( String( value ) )}`;

}

function hash32( value ) {

	let hash = 2166136261;
	for ( let index = 0; index < value.length; index ++ ) {

		hash ^= value.charCodeAt( index );
		hash = Math.imul( hash, 16777619 );

	}
	return hash >>> 0;

}
