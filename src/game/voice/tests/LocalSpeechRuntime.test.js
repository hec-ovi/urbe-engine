import { describe, expect, it, vi } from 'vitest';
import {
	LocalSpeechRuntime, NpcVoiceClient, PcmAudioPlayer
} from '../index.js';
import { encodeBase64, sha256Hex } from '../src/Canonical.js';

const MODEL = '3f1744aa82085028edd386374b1ebe29f163d84d7662d649c49e8dae8cfd8957';
const CONDS = 'b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033';

describe( 'local speech browser runtime', () => {

	it( 'drives the validated voice client and normalized microphone media through HTTP', async () => {

		const bytes = new Uint8Array( [ 0, 0, 255, 127 ] );
		const digest = await sha256Hex( bytes );
		const calls = [];
		const fetchImpl = vi.fn( async ( url, init = {} ) => {

			calls.push( { url, init } );
			if ( url.endsWith( '/capabilities' ) ) return response( capabilities() );
			if ( url.endsWith( '/synthesize' ) ) {

				const request = JSON.parse( init.body );
				expect( request.profileRecord.profile.preset ).toEqual( {
					presetId: 'chatterbox-nano-built-in', artifactSha256: CONDS
				} );
				return response( { chunk: {
					version: '1', requestId: request.requestId, segmentIndex: request.segmentIndex,
					sequence: 0, sampleRate: 24000, channels: 1, codec: 'pcm_s16le',
					frameCount: 2, byteSize: 4, sha256: digest, dataBase64: encodeBase64( bytes ), spanIndex: 0
				} } );

			}
			const request = JSON.parse( init.body );
			expect( request.mediaType ).toBe( 'audio/webm' );
			expect( request.byteSize ).toBe( 4 );
			expect( request.sha256 ).toBe( digest );
			expect( request ).not.toHaveProperty( 'language' );
			return response( {
				version: '1', requestId: request.requestId, text: 'meet me at central',
				language: 'en', languageProbability: 0.99,
				segments: [ { startSeconds: 0, endSeconds: 1, text: 'meet me at central' } ]
			} );

		} );
		const runtime = await LocalSpeechRuntime.connect( { endpoint: '/api/speech', fetchImpl } );
		const client = new NpcVoiceClient( { adapter: runtime } );
		const profile = await client.registerProfile( profileFor( runtime.capabilities().engine ) );
		await client.start( {
			version: '1', requestId: 'dialogue-one', npcId: 'npc-one', profileDigest: profile.profileDigest,
			priority: 'conversation', content: [ { kind: 'text', text: 'Meet me at Central.' } ], delivery: {},
			inference: { seed: 7, options: {} }, outputCodecVersion: 'pcm-s16le-v1'
		} );
		const speech = await client.wait( { version: '1', requestId: 'dialogue-one' } );
		expect( speech ).toMatchObject( { status: 'completed', chunks: [ { frameCount: 2 } ] } );

		const transcript = await runtime.transcribe( new Blob( [ bytes ], { type: 'audio/webm;codecs=opus' } ), {
			requestId: 'microphone-one', language: 'auto'
		} );
		expect( transcript.text ).toBe( 'meet me at central' );
		await expect( runtime.transcribe( new Blob( [ bytes ], { type: 'audio/webm' } ), {
			language: 'es'
		} ) ).rejects.toMatchObject( { code: 'E_VOICE_INPUT' } );
		expect( calls.map( ( call ) => call.url ) ).toEqual( [
			'/api/speech/capabilities', '/api/speech/synthesize', '/api/speech/transcribe'
		] );

	} );

	it( 'schedules absolute frame gaps and resolves a cancelled playback', async () => {

		const context = audioContext();
		const player = new PcmAudioPlayer( { contextFactory: () => context } );
		const playing = player.play( [ pcmChunk( 0, 2 ), pcmChunk( 4, 2 ) ] );
		await vi.waitFor( () => expect( context.sources ).toHaveLength( 2 ) );
		expect( context.sources.map( ( source ) => source.startedAt ) ).toEqual( [ 10, 11 ] );
		context.sources.at( -1 ).onended();
		await playing;

		const cancelled = player.play( [ pcmChunk( 0, 4 ) ] );
		await vi.waitFor( () => expect( context.sources ).toHaveLength( 3 ) );
		player.cancel();
		await expect( cancelled ).resolves.toBeUndefined();
		expect( context.sources.at( -1 ).stop ).toHaveBeenCalledOnce();

	} );

	it( 'does not schedule audio cancelled while the player gesture unlock is pending', async () => {

		let finishResume;
		const context = audioContext();
		context.resume = vi.fn( () => new Promise( ( resolve ) => { finishResume = resolve; } ) );
		const player = new PcmAudioPlayer( { contextFactory: () => context } );
		const pending = player.play( [ pcmChunk( 0, 4 ) ] );
		await Promise.resolve();
		player.cancel();
		finishResume();

		await expect( pending ).resolves.toBeUndefined();
		expect( context.sources ).toEqual( [] );

	} );

	it( 'requests Web Audio resume in the same call that handles the player gesture', async () => {

		const context = audioContext();
		const player = new PcmAudioPlayer( { contextFactory: () => context } );
		const unlocked = player.unlock();

		expect( context.resume ).toHaveBeenCalledOnce();
		await expect( unlocked ).resolves.toBeUndefined();

	} );

} );

function capabilities() {

	return {
		tts: {
			version: '1', adapterId: 'chatterbox-nano-local', streaming: false, cancellable: true, maxConcurrent: 1,
			languages: [ 'en-US' ], engine: {
				backendId: 'chatterbox-nano', modelRevision: 'ResembleAI/chatterbox-nano@71ccd1d', modelSha256: MODEL,
				runtimeId: 'urbe-local-speech', runtimeRevision: '1.0.0', runtimeSha256: '1'.repeat( 64 )
			},
			output: { sampleRate: 24000, channels: 1, codec: 'pcm_s16le', codecVersion: 'pcm-s16le-v1' },
			controls: {
				laugh: 'native', chuckle: 'native', cough: 'native', breath: 'unsupported', sigh: 'unsupported',
				whisper: 'unsupported', pause_ms: 'exact-silence', emotion: 'unsupported'
			}
		},
		stt: {
			version: '1', adapterId: 'faster-whisper-local', modelRevision: 'Systran/faster-whisper-small@536b066',
			modelSha256: '2'.repeat( 64 ), runtimeRevision: 'faster-whisper-1.2.1',
			mediaTypes: [ 'audio/wav', 'audio/webm', 'audio/ogg', 'audio/mp4' ], languages: [ 'auto', 'en' ]
		}
	};

}

function profileFor( engine ) {

	return {
		version: '1', profileId: 'voice-npc-one', npcId: 'npc-one', revision: 1, seed: 9, language: 'en-US',
		delivery: { pace: 1, pitchSemitones: 0, energy: 1 },
		preset: { presetId: 'chatterbox-nano-built-in', artifactSha256: CONDS },
		engine, approvedReactions: []
	};

}

function response( payload, status = 200 ) {

	return new Response( JSON.stringify( payload ), {
		status, headers: { 'Content-Type': 'application/json' }
	} );

}

function pcmChunk( startFrame, frameCount ) {

	return {
		startFrame, frameCount, sampleRate: 4, channels: 1, codec: 'pcm_s16le',
		dataBase64: encodeBase64( new Uint8Array( frameCount * 2 ) )
	};

}

function audioContext() {

	return {
		currentTime: 10,
		destination: {},
		sources: [],
		resume: vi.fn(),
		createBuffer: ( channels, frames ) => {

			const data = Array.from( { length: channels }, () => new Float32Array( frames ) );
			return { getChannelData: ( channel ) => data[ channel ] };

		},
		createBufferSource() {

			const source = {
				connect: vi.fn(), stop: vi.fn(), start( at ) { source.startedAt = at; }
			};
			this.sources.push( source );
			return source;

		}
	};

}
