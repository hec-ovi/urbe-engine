import { afterEach, describe, expect, it, vi } from 'vitest';
import { TalkClient } from './TalkClient.js';

const conversation = {
	instance: { npcId: 'n1', name: { given: 'Mara', family: 'Voss' } },
	behavior: { activity: 'working' }
};

afterEach( () => vi.unstubAllGlobals() );

/** A streamed body cut into the given pieces, wherever they split the lines. */
function streamed( ...pieces ) {

	const encoder = new TextEncoder();
	return new Response( new ReadableStream( {
		start( controller ) {

			for ( const piece of pieces ) controller.enqueue( encoder.encode( piece ) );
			controller.close();

		}
	} ), { headers: { 'Content-Type': 'application/x-ndjson' } } );

}

async function collect( iterable ) {

	const events = [];
	for await ( const event of iterable ) events.push( event );
	return events;

}

describe( 'TalkClient', () => {

	it( 'posts the line with the person, their state and the questlines, and names the person', async () => {

		const fetch = vi.fn( async () => streamed( '{"type":"delta","text":"Not now."}\n{"type":"done","reply":"Not now."}\n' ) );
		vi.stubGlobal( 'fetch', fetch );
		const quests = [ { id: 'q1', cast: {}, state: {} } ];

		await collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 42, quests ) );

		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( '/api/talk/stream' );
		expect( JSON.parse( fetch.mock.calls[ 0 ][ 1 ].body ) ).toEqual( {
			out: '/out/w', npc: conversation.instance, behavior: conversation.behavior, line: 'Hello', timeMin: 42, quests
		} );
		expect( TalkClient.nameOf( conversation.instance ) ).toBe( 'Mara Voss' );

	} );

	it( 'streams the events of one reply, whatever the pieces the lines arrive in', async () => {

		const events = [
			{ type: 'delta', text: 'Meet me. ' }, { type: 'sentence', index: 0, text: 'Meet me.' },
			{ type: 'offer', kind: 'lead', placeId: 'p1', name: 'The Rusty Anchor' }, { type: 'done', reply: 'Meet me.' }
		];
		const text = events.map( ( event ) => `${JSON.stringify( event )}\n` ).join( '' );
		for ( const cut of [ 1, 7, 40, text.length - 1 ] ) {

			const fetch = vi.fn( async () => streamed( text.slice( 0, cut ), text.slice( cut ) ) );
			vi.stubGlobal( 'fetch', fetch );
			const guide = { placeId: 'p1', kind: 'parcel' };
			const offers = { places: [ { placeId: 'p1', name: 'The Rusty Anchor' } ] };
			expect( await collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 42, [], { guide, offers } ) ) ).toEqual( events );
			expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( '/api/talk/stream' );
			expect( JSON.parse( fetch.mock.calls[ 0 ][ 1 ].body ) ).toMatchObject( { line: 'Hello', guide, offers } );

		}

	} );

	it( 'throws a refused or failed request with its HTTP status, and a failed stream with 502', async () => {

		vi.stubGlobal( 'fetch', async () => Response.json( { error: 'talk request does not match its contract: /npc/mood' }, { status: 400 } ) );
		await expect( collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 0 ) ) ).rejects.toMatchObject( {
			message: 'talk request does not match its contract: /npc/mood', status: 400
		} );

		vi.stubGlobal( 'fetch', async () => new Response( '<html>gateway</html>', { status: 504 } ) );
		await expect( collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 0 ) ) ).rejects.toMatchObject( { message: 'talk 504', status: 504 } );

		vi.stubGlobal( 'fetch', async () => streamed( '{"type":"delta","text":"Meet"}\n{"type":"error","error":"model server 500 at x"}\n' ) );
		const seen = [];
		await expect( ( async () => {

			for await ( const event of new TalkClient( '/out/w' ).stream( conversation, 'Hello', 0 ) ) seen.push( event );

		} )() ).rejects.toMatchObject( { message: 'model server 500 at x', status: 502 } );
		expect( seen ).toEqual( [ { type: 'delta', text: 'Meet' } ] );

		vi.stubGlobal( 'fetch', async () => streamed( '{"type":"delta","text":"Meet"}\n' ) );
		await expect( collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 0 ) ) ).rejects.toMatchObject( { status: 502 } );

		vi.stubGlobal( 'fetch', async () => Response.json( { error: 'model server 503 at x' }, { status: 502 } ) );
		await expect( collect( new TalkClient( '/out/w' ).stream( conversation, 'Hello', 0 ) ) ).rejects.toMatchObject( {
			message: 'model server 503 at x', status: 502
		} );

	} );

	it( 'reads the world\'s dialogue memory for a save and replaces it from one', async () => {

		const memory = [ { npcId: 'n1', memory: { digest: [], turns: [ { speaker: 'npc', text: 'Hi.', atMin: 1 } ] } } ];
		const fetch = vi.fn( async ( _url, init ) => init ? new Response( null, { status: 204 } ) : Response.json( { out: '/out/games/g 1', memory } ) );
		vi.stubGlobal( 'fetch', fetch );
		const client = new TalkClient( '/out/games/g 1' );

		expect( await client.memory() ).toEqual( memory );
		expect( fetch.mock.calls[ 0 ] ).toEqual( [ '/api/talk/memory?out=%2Fout%2Fgames%2Fg%201' ] );
		await client.restoreMemory( memory );
		expect( fetch.mock.calls[ 1 ][ 0 ] ).toBe( '/api/talk/memory' );
		expect( fetch.mock.calls[ 1 ][ 1 ].method ).toBe( 'PUT' );
		expect( JSON.parse( fetch.mock.calls[ 1 ][ 1 ].body ) ).toEqual( { out: '/out/games/g 1', memory } );

		vi.stubGlobal( 'fetch', async () => Response.json( { error: 'talk memory does not match its contract' }, { status: 400 } ) );
		await expect( client.restoreMemory( memory ) ).rejects.toMatchObject( { message: 'talk memory does not match its contract', status: 400 } );
		await expect( client.memory() ).rejects.toMatchObject( { status: 400 } );

	} );

} );
