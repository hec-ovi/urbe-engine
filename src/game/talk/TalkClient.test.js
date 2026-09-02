import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalkClient } from './TalkClient.js';

const conversation = {
	instance: { npcId: 'n1', name: { given: 'Mara', family: 'Voss' } },
	behavior: { activity: 'working' }
};

afterEach( () => vi.unstubAllGlobals() );

describe( 'TalkClient', () => {

	it( 'posts the line with the person and their state, and returns the reply', async () => {

		const fetch = vi.fn( async () => ( { ok: true, json: async () => ( { reply: 'Not now.' } ) } ) );
		vi.stubGlobal( 'fetch', fetch );

		const reply = await new TalkClient( '/out/w' ).say( conversation, 'Hello', 42 );

		expect( reply ).toBe( 'Not now.' );
		expect( JSON.parse( fetch.mock.calls[ 0 ][ 1 ].body ) ).toEqual( {
			out: '/out/w', npc: conversation.instance, behavior: conversation.behavior, line: 'Hello', timeMin: 42
		} );
		expect( TalkClient.nameOf( conversation.instance ) ).toBe( 'Mara Voss' );

	} );

	it( 'throws the server error when the model is unreachable', async () => {

		vi.stubGlobal( 'fetch', async () => ( { ok: false, status: 502, json: async () => ( { error: 'model server 000 at x' } ) } ) );
		await expect( new TalkClient( '/out/w' ).say( conversation, 'Hello', 0 ) ).rejects.toThrow( 'model server 000 at x' );

	} );

} );
