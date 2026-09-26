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

	it( 'posts the line with the person and their state, and returns the reply', async () => {

		const fetch = vi.fn( async () => Response.json( { reply: 'Not now.' } ) );
		vi.stubGlobal( 'fetch', fetch );

		const reply = await new TalkClient( '/out/w' ).say( conversation, 'Hello', 42, [ { id: 'q1', cast: {}, state: {} } ] );

		expect( reply ).toBe( 'Not now.' );
		expect( fetch.mock.calls[ 0 ][ 0 ] ).toBe( '/api/talk' );
		expect( JSON.parse( fetch.mock.calls[ 0 ][ 1 ].body ) ).toEqual( {
			out: '/out/w', npc: conversation.instance, behavior: conversation.behavior, line: 'Hello', timeMin: 42, quests: [ { id: 'q1', cast: {}, state: {} } ]
		} );
		expect( TalkClient.nameOf( conversation.instance ) ).toBe( 'Mara Voss' );

	} );

	it( 'throws the server error with its HTTP status', async () => {

		vi.stubGlobal( 'fetch', async () => Response.json( { error: 'talk request does not match its contract: /npc/mood' }, { status: 400 } ) );
		await expect( new TalkClient( '/out/w' ).say( conversation, 'Hello', 0 ) ).rejects.toMatchObject( {
			message: 'talk request does not match its contract: /npc/mood', status: 400
		} );

		vi.stubGlobal( 'fetch', async () => new Response( '<html>gateway</html>', { status: 504 } ) );
		await expect( new TalkClient( '/out/w' ).say( conversation, 'Hello', 0 ) ).rejects.toMatchObject( { message: 'talk 504', status: 504 } );

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

	it( 'throws a failed stream with a status', async () => {

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

} );
