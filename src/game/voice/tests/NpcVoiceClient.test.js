import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import capabilityFixture from '../fixtures/capability-manifest.json';
import requestFixture from '../fixtures/speech-request.json';
import profileFixture from '../fixtures/voice-profile.json';
import {
	AudioWorkletPacketTransport,
	FakeVoiceAdapter,
	NpcVoiceClient,
	VoiceBoundary
} from '../index.js';
import { decodeBase64, sha256Hex } from '../src/Canonical.js';

describe( 'NPC voice client contract', () => {

	it( 'streams ordered checked chunks, native controls, and exact pause frames', async () => {

		const { client, record, adapter } = await setup();
		const request = requestFor( record, {
			requestId: 'speech-native-controls',
			content: [
				{ kind: 'text', text: 'I saw the courier.' },
				{ kind: 'control', control: 'laugh' },
				{ kind: 'control', control: 'pause_ms', durationMs: 250 },
				{ kind: 'control', control: 'whisper', enabled: true },
				{ kind: 'control', control: 'emotion', emotion: 'fear', intensity: 0.7 },
				{ kind: 'text', text: 'Keep your voice down.' }
			]
		} );

		const accepted = await client.start( request );
		const result = await client.wait( { version: '1', requestId: request.requestId } );

		expect( accepted ).toMatchObject( { status: 'queued', cacheKey: result.cacheKey } );
		expect( result.status ).toBe( 'completed' );
		expect( result.cache ).toBe( 'miss' );
		expect( result.chunks.map( ( chunk ) => chunk.sequence ) )
			.toEqual( result.chunks.map( ( _, index ) => index ) );
		for ( let index = 1; index < result.chunks.length; index ++ ) {

			expect( result.chunks[ index ].startFrame )
				.toBe( result.chunks[ index - 1 ].startFrame + result.chunks[ index - 1 ].frameCount );

		}
		for ( const chunk of result.chunks ) {

			const bytes = decodeBase64( chunk.dataBase64 );
			expect( bytes.byteLength ).toBe( chunk.byteSize );
			expect( await sha256Hex( bytes ) ).toBe( chunk.sha256 );

		}

		const silence = result.chunks.find( ( chunk ) => chunk.source.kind === 'silence' );
		expect( silence ).toMatchObject( { frameCount: 6000, byteSize: 12000 } );
		expect( decodeBase64( silence.dataBase64 ).every( ( byte ) => byte === 0 ) ).toBe( true );
		expect( result.realizedControls ).toEqual( [
			{ spanIndex: 1, control: 'laugh', resolution: 'native' },
			{ spanIndex: 2, control: 'pause_ms', resolution: 'silence' },
			{ spanIndex: 3, control: 'whisper', resolution: 'native' },
			{ spanIndex: 4, control: 'emotion', resolution: 'native' }
		] );
		expect( adapter.trace.started ).toEqual( [ request.requestId, request.requestId ] );

		const playback = client.transport.read( {
			version: '1', requestId: request.requestId, afterSequence: 0
		} );
		expect( playback.status ).toBe( 'completed' );
		expect( playback.complete ).toBe( true );
		expect( playback.chunks.every( ( chunk ) => chunk.sequence > 0 ) ).toBe( true );

	} );

	it( 'replays a content-addressed cache entry without invoking the adapter', async () => {

		const { client, record, adapter } = await setup();
		const first = requestFor( record, { requestId: 'speech-cache-1' } );
		const firstStart = await client.start( first );
		const firstResult = await client.wait( { version: '1', requestId: first.requestId } );
		const synthesisCount = adapter.trace.started.length;

		const second = requestFor( record, { requestId: 'speech-cache-2' } );
		const secondStart = await client.start( second );
		const secondResult = await client.wait( { version: '1', requestId: second.requestId } );

		expect( secondStart.cacheKey ).toBe( firstStart.cacheKey );
		expect( secondResult ).toMatchObject( { status: 'completed', cache: 'hit' } );
		expect( secondResult.chunks ).toEqual( firstResult.chunks );
		expect( adapter.trace.started ).toHaveLength( synthesisCount );
		expect( client.transport.history( { version: '1', requestId: second.requestId } ).events
			.map( ( event ) => event.type ) ).toContain( 'cache-hit' );

	} );

	it( 'uses an approved reaction and fails closed for an unsupported control', async () => {

		const manifest = structuredClone( capabilityFixture );
		manifest.controls.laugh = 'reaction';
		manifest.controls.chuckle = 'unsupported';
		const { client, record, adapter } = await setup( { manifest } );
		const reactionRequest = requestFor( record, {
			requestId: 'speech-reaction',
			content: [ { kind: 'control', control: 'laugh' } ]
		} );

		await client.start( reactionRequest );
		const reactionResult = await client.wait( { version: '1', requestId: reactionRequest.requestId } );
		expect( reactionResult.chunks ).toHaveLength( 1 );
		expect( reactionResult.chunks[ 0 ].source ).toEqual( {
			kind: 'reaction', spanIndex: 0, control: 'laugh'
		} );
		expect( reactionResult.realizedControls[ 0 ] ).toMatchObject( {
			control: 'laugh', resolution: 'reaction', reactionSha256: profileFixture.approvedReactions[ 0 ].audio.sha256
		} );
		expect( adapter.trace.started ).toHaveLength( 0 );

		await expect( client.start( requestFor( record, {
			requestId: 'speech-unsupported',
			content: [ { kind: 'control', control: 'chuckle' } ]
		} ) ) ).rejects.toMatchObject( { code: 'E_VOICE_CONTROL' } );

	} );

	it( 'cancels active synthesis and emits a terminal cancellation', async () => {

		const { client, record, adapter } = await setup( { delayMs: 40 } );
		const request = requestFor( record, {
			requestId: 'speech-cancel-active',
			content: [ { kind: 'text', text: 'This line should be interrupted.' } ]
		} );
		await client.start( request );
		await adapter.waitForStart( request.requestId );

		const cancellation = client.cancel( {
			version: '1', requestId: request.requestId, reason: 'speaker-changed'
		} );
		const result = await client.wait( { version: '1', requestId: request.requestId } );

		expect( cancellation ).toEqual( {
			version: '1', requestId: request.requestId, cancelled: true, previousStatus: 'active'
		} );
		expect( result ).toMatchObject( { status: 'cancelled', reason: 'speaker-changed' } );
		expect( adapter.trace.cancelled ).toContain( request.requestId );
		expect( client.transport.history( { version: '1', requestId: request.requestId } ).events.at( -1 ) )
			.toMatchObject( { type: 'cancelled', reason: 'speaker-changed' } );

	} );

	it( 'schedules conversation before queued background speech', async () => {

		const manifest = structuredClone( capabilityFixture );
		manifest.maxConcurrent = 1;
		const { client, record, adapter } = await setup( { manifest, delayMs: 30 } );
		const blocker = requestFor( record, {
			requestId: 'speech-blocker', priority: 'background', content: [ { kind: 'text', text: 'Blocker' } ]
		} );
		await client.start( blocker );
		await adapter.waitForStart( blocker.requestId );

		const background = requestFor( record, {
			requestId: 'speech-background', priority: 'background', content: [ { kind: 'text', text: 'Background' } ]
		} );
		const conversation = requestFor( record, {
			requestId: 'speech-conversation', priority: 'conversation', content: [ { kind: 'text', text: 'Conversation' } ]
		} );
		await client.start( background );
		await client.start( conversation );
		client.cancel( { version: '1', requestId: blocker.requestId, reason: 'stale' } );

		await Promise.all( [ blocker, conversation, background ].map( ( request ) =>
			client.wait( { version: '1', requestId: request.requestId } )
		) );
		expect( adapter.trace.started.slice( 0, 3 ) ).toEqual( [
			blocker.requestId, conversation.requestId, background.requestId
		] );

	} );

	it( 'runs two priorities concurrently within the manifest limit', async () => {

		const { client, record, adapter } = await setup( { delayMs: 30 } );
		const background = requestFor( record, {
			requestId: 'speech-concurrent-background',
			priority: 'background',
			content: [ { kind: 'text', text: 'Station announcement' } ]
		} );
		const conversation = requestFor( record, {
			requestId: 'speech-concurrent-conversation',
			priority: 'conversation',
			content: [ { kind: 'text', text: 'Focused dialogue' } ]
		} );

		await client.start( background );
		await client.start( conversation );
		await Promise.all( [ background, conversation ].map( ( request ) =>
			client.wait( { version: '1', requestId: request.requestId } )
		) );

		expect( adapter.trace.maxObservedConcurrent ).toBe( 2 );
		for ( const request of [ background, conversation ] ) {

			const chunks = client.transport.read( {
				version: '1', requestId: request.requestId, afterSequence: -1
			} ).chunks;
			expect( chunks[ 0 ].sequence ).toBe( 0 );

		}

	} );

	it( 'rejects schema drift and immutable profile revision changes', async () => {

		const adapter = new FakeVoiceAdapter( { manifest: capabilityFixture } );
		const client = new NpcVoiceClient( { adapter } );
		const invalid = { ...structuredClone( profileFixture ), derivedEmbedding: [ 0.1, 0.2 ] };
		await expect( client.registerProfile( invalid ) ).rejects.toMatchObject( { code: 'E_VOICE_INPUT' } );

		await client.registerProfile( profileFixture );
		const changed = structuredClone( profileFixture );
		changed.reference.transcript = 'A changed recording transcript.';
		await expect( client.registerProfile( changed ) ).rejects.toMatchObject( { code: 'E_VOICE_PROFILE' } );

	} );

	it( 'fails a result when adapter bytes do not match their checksum', async () => {

		const base = new FakeVoiceAdapter( { manifest: capabilityFixture } );
		const adapter = {
			capabilities: () => base.capabilities(),
			async *synthesize( request, signal ) {

				for await ( const chunk of base.synthesize( request, signal ) ) {

					yield { ...chunk, sha256: '0000000000000000000000000000000000000000000000000000000000000000' };

				}

			}
		};
		const client = new NpcVoiceClient( { adapter } );
		const record = await client.registerProfile( profileFixture );
		const request = requestFor( record, {
			requestId: 'speech-bad-checksum', content: [ { kind: 'text', text: 'Bad bytes' } ]
		} );

		await client.start( request );
		const result = await client.wait( { version: '1', requestId: request.requestId } );
		expect( result ).toMatchObject( { status: 'failed', error: { code: 'E_VOICE_CHUNK' } } );

	} );

	it( 'fails when a pause cannot be represented by a whole PCM frame', async () => {

		const manifest = structuredClone( capabilityFixture );
		manifest.output.sampleRate = 22050;
		const profile = structuredClone( profileFixture );
		profile.approvedReactions = [];
		const { client, record } = await setup( { manifest, profile } );
		const request = requestFor( record, {
			requestId: 'speech-inexact-silence',
			content: [ { kind: 'control', control: 'pause_ms', durationMs: 1 } ]
		} );

		await client.start( request );
		const result = await client.wait( { version: '1', requestId: request.requestId } );
		expect( result ).toMatchObject( { status: 'failed', error: { code: 'E_VOICE_SILENCE' } } );

	} );

} );

describe( 'NPC voice JSON boundaries', () => {

	it( 'rejects malformed playback and lifecycle envelopes', () => {

		const boundary = new VoiceBoundary();
		const transport = new AudioWorkletPacketTransport( { boundary } );
		expect( () => transport.read( {
			version: '1', requestId: 'voice-read', afterSequence: -2
		} ) ).toThrowError( expect.objectContaining( { code: 'E_VOICE_INPUT' } ) );
		expect( () => transport.push( {
			version: '1', requestId: 'voice-read', eventSequence: 0, type: 'chunk'
		} ) ).toThrowError( expect.objectContaining( { code: 'E_VOICE_INPUT' } ) );
		expect( () => transport.push( {
			version: '1',
			requestId: 'voice-read',
			eventSequence: 0,
			type: 'started',
			cacheKey: '5555555555555555555555555555555555555555555555555555555555555555',
			reason: 'stale'
		} ) ).toThrowError( expect.objectContaining( { code: 'E_VOICE_INPUT' } ) );

	} );

	it( 'keeps every contract schema link resolvable', async () => {

		const contractUrl = new URL( '../CONTRACT.md', import.meta.url );
		const contract = await readFile( contractUrl, 'utf8' );
		const schemaLinks = [ ...contract.matchAll( /\(schema\/([^)]+\.json)\)/g ) ]
			.map( ( match ) => match[ 1 ] );
		expect( schemaLinks.length ).toBeGreaterThan( 0 );
		for ( const schemaName of schemaLinks ) {

			const schemaUrl = new URL( `../schema/${schemaName}`, import.meta.url );
			expect( ( await stat( fileURLToPath( schemaUrl ) ) ).isFile() ).toBe( true );

		}

	} );

} );

async function setup( {
	manifest = capabilityFixture,
	profile = profileFixture,
	delayMs = 0
} = {} ) {

	const adapter = new FakeVoiceAdapter( { manifest, delayMs } );
	const client = new NpcVoiceClient( { adapter } );
	const record = await client.registerProfile( profile );
	return { adapter, client, record };

}

function requestFor( record, overrides = {} ) {

	return {
		...structuredClone( requestFixture ),
		profileDigest: record.profileDigest,
		...structuredClone( overrides )
	};

}
