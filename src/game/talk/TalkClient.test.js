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

	it( 'sends the lines said with the person since their last reply ahead of the line, each once and at its minute, until a reply is done', async () => {

		const bodies = [];
		let fail = false;
		vi.stubGlobal( 'fetch', async ( _url, init ) => {

			bodies.push( JSON.parse( init.body ) );
			return fail ? Response.json( { error: 'model server down' }, { status: 502 } ) : streamed( '{"type":"done","reply":"The file."}\n' );

		} );
		const client = new TalkClient( '/out/w' );
		client.said( 'n9', 'npc', 'Someone else.', 1 );
		client.said( 'n1', 'npc', '[sigh] Femke Zwart. Six days gone.', 2 );
		client.said( 'n1', 'player', 'And if she is alive?', 3 );
		// The talk closed and opened again: its opening shows again, and goes once.
		client.said( 'n1', 'npc', '[sigh] Femke Zwart. Six days gone.', 90 );
		const shown = [ { speaker: 'npc', text: '[sigh] Femke Zwart. Six days gone.', atMin: 2 }, { speaker: 'player', text: 'And if she is alive?', atMin: 3 } ];

		fail = true;
		await expect( collect( client.stream( conversation, 'What?', 0 ) ) ).rejects.toMatchObject( { status: 502 } );
		fail = false;
		await collect( client.stream( conversation, 'What are you talking about?', 0 ) );
		await collect( client.stream( conversation, 'I see.', 0 ) );
		expect( bodies.map( ( body ) => body.prior ) ).toEqual( [ shown, shown, undefined ] );

		client.said( 'n1', 'npc', '[sigh] Femke Zwart. Six days gone.', 95 );
		await collect( client.stream( conversation, 'Again?', 0 ) );
		expect( bodies[ 3 ].prior ).toEqual( [ { speaker: 'npc', text: '[sigh] Femke Zwart. Six days gone.', atMin: 95 } ] );

		for ( let i = 0; i < 14; i ++ ) client.said( 'n1', 'npc', String.fromCharCode( 97 + i ).repeat( 5000 ), 100 + i );
		await collect( client.stream( conversation, 'Go on.', 0 ) );
		expect( bodies[ 4 ].prior ).toHaveLength( 12 );
		expect( bodies[ 4 ].prior[ 0 ] ).toEqual( { speaker: 'npc', text: 'c'.repeat( 4000 ), atMin: 102 } );

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

		vi.stubGlobal( 'fetch', async () => Response.json( { error: 'no world at /out/games/g 1' }, { status: 502 } ) );
		await expect( client.memory() ).rejects.toMatchObject( { message: 'no world at /out/games/g 1', status: 502 } );

	} );

	it( 'hands a save\'s memory over before any talk or memory read until the server takes it, once at a time', async () => {

		const memory = [ { npcId: 'n1', memory: { digest: [ 'Owes the player.' ], turns: [] } } ];
		const puts = [];
		let refuse = true;
		const fetch = vi.fn( async ( url, init ) => {

			if ( init?.method === 'PUT' ) {

				puts.push( JSON.parse( init.body ) );
				return refuse ? Response.json( { error: 'model server down' }, { status: 502 } ) : new Response( null, { status: 204 } );

			}
			if ( url.startsWith( '/api/talk/memory' ) ) return Response.json( { out: '/out/w', memory } );
			return streamed( '{"type":"done","reply":"Hi."}\n' );

		} );
		vi.stubGlobal( 'fetch', fetch );
		const client = new TalkClient( '/out/w' );

		await expect( client.restoreMemory( memory ) ).rejects.toMatchObject( { status: 502 } );
		// Nothing is said, or read for a save, without the saved memory in place.
		await expect( collect( client.stream( conversation, 'Hello', 0 ) ) ).rejects.toMatchObject( { message: 'model server down' } );
		await expect( client.memory() ).rejects.toMatchObject( { status: 502 } );
		expect( fetch.mock.calls.filter( ( [ url ] ) => url !== '/api/talk/memory' ) ).toEqual( [] );

		refuse = false;
		await Promise.all( [ collect( client.stream( conversation, 'Hello', 0 ) ), client.memory() ] );
		await client.memory();
		expect( puts ).toEqual( Array( 4 ).fill( { out: '/out/w', memory } ) );
		expect( fetch.mock.calls.map( ( [ url, init ] ) => `${init?.method ?? 'GET'} ${url.split( '?' )[ 0 ]}` ).slice( - 4 ) ).toEqual( [
			'PUT /api/talk/memory', 'POST /api/talk/stream', 'GET /api/talk/memory', 'GET /api/talk/memory'
		] );

	} );

} );
