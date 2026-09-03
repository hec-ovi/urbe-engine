import { describe, expect, it, vi } from 'vitest';
import { DialogueSpeech } from '../index.js';

describe( 'live dialogue speech composition', () => {

	it( 'registers the verified built-in preset and brackets audible playback', async () => {

		const rig = setup();
		const lifecycle = [];
		await expect( rig.speech.speak( { npcId: 'npc-ada' }, 'The tram is late.', {
			onPlaybackStart: () => lifecycle.push( 'started' ),
			onPlaybackEnd: () => lifecycle.push( 'ended' )
		} ) ).resolves.toBe( true );

		expect( rig.client.registerProfile ).toHaveBeenCalledWith( expect.objectContaining( {
			npcId: 'npc-ada',
			preset: {
				presetId: 'chatterbox-nano-built-in',
				artifactSha256: 'b1852099306fd6a7814eb9d0bd10186caba7249596cc23868f78a0eefbfa5033'
			}
		} ) );
		expect( rig.client.start ).toHaveBeenCalledWith( expect.objectContaining( {
			npcId: 'npc-ada', content: [ { kind: 'text', text: 'The tram is late.' } ],
			outputCodecVersion: 'pcm-s16le-v1'
		} ) );
		expect( lifecycle ).toEqual( [ 'started', 'ended' ] );

	} );

	it( 'cancels synthesis without starting playback when a new line supersedes it', async () => {

		let resolveWait;
		const rig = setup();
		rig.client.wait.mockReturnValue( new Promise( ( resolve ) => { resolveWait = resolve; } ) );
		const lifecycle = vi.fn();
		const pending = rig.speech.speak( { npcId: 'npc-ada' }, 'Wait.', { onPlaybackStart: lifecycle } );
		await vi.waitFor( () => expect( rig.client.start ).toHaveBeenCalledOnce() );
		rig.speech.cancel( 'new-line' );
		resolveWait( { status: 'cancelled' } );

		await expect( pending ).resolves.toBe( false );
		expect( rig.client.cancel ).toHaveBeenCalledWith( expect.objectContaining( {
			reason: 'new-line'
		} ) );
		expect( rig.player.play ).not.toHaveBeenCalled();
		expect( lifecycle ).not.toHaveBeenCalled();

	} );

} );

function setup() {

	const engine = {
		backendId: 'chatterbox-nano', modelRevision: 'nano', modelSha256: '1'.repeat( 64 ),
		runtimeId: 'urbe-local-speech', runtimeRevision: '1', runtimeSha256: '2'.repeat( 64 )
	};
	const client = {
		capabilities: vi.fn( () => ( {
			engine, output: { codecVersion: 'pcm-s16le-v1' }
		} ) ),
		registerProfile: vi.fn( async () => ( { profileDigest: '3'.repeat( 64 ) } ) ),
		start: vi.fn( async () => {} ),
		wait: vi.fn( async ( { requestId } ) => ( {
			status: 'completed', requestId, chunks: [ { sequence: 0 } ]
		} ) ),
		cancel: vi.fn()
	};
	const player = {
		unlock: vi.fn( async () => {} ),
		cancel: vi.fn(),
		play: vi.fn( async ( _chunks, { onStart } ) => onStart() )
	};
	const microphone = { start: vi.fn(), stop: vi.fn(), cancel: vi.fn() };
	return {
		client, player,
		speech: new DialogueSpeech( { runtime: {}, client, player, microphone } )
	};

}
