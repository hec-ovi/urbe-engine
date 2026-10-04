/**
 * Each action a person agrees to in words alone happens: a real conversation
 * goes from the game's chat through TalkClient and the talk route (an HTTP
 * server over TalkService and Quests' Converse) to a model that says yes and
 * calls no tool, and back into the game, whose companion, contacts and
 * inventory take what was agreed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Node runs this file, so the server side reads its prompt files by file URL as it does in the dev server;
// the game gets a jsdom page of its own, with Node's URL kept for the server.
await vi.hoisted( async () => {

	const { JSDOM } = await import( 'jsdom' );
	const { populateGlobal } = await import( 'vitest/environments' );
	const NodeURL = globalThis.URL;
	const dom = new JSDOM( '<!DOCTYPE html>', { url: 'http://localhost:3000', pretendToBeVisual: true } );
	populateGlobal( globalThis, dom.window, { bindFunctions: true } );
	globalThis.URL = NodeURL;

} );
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { FIXTURE_BLUEPRINT } from '../../../../simulation/dist/index.js';
import { stubCanvas } from '../../ui/test-helpers/canvas.js';
import { TalkService } from '../../server/TalkService.js';
import { talkRoute } from '../../server/talkRoute.js';
import { GameApp } from '../GameApp.js';
import { AddressBook } from '../access/Addresses.js';
import { cardId } from '../access/Access.js';
import { AFTERNOON, setup } from '../companion/companion.test-fixtures.js';
import { TalkClient } from './TalkClient.js';

const square = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];
/** The barista's home block: apartment 701 off its seventh floor's corridor. */
const HOME_BLOCK = {
	interior: {
		building: { floors: [ { index: 7, layout: 'middle', elevation: 28, openings: {}, apartmentEntrances: [
			{ unit: 'f7-unit-1', number: '701', position: [ 5, 2 ], inward: [ 0, 1 ], width: 1.6 }
		] } ] },
		layouts: { middle: { floor: { kind: 'apartment', rooms: [
			{ id: 'f7-corridor', kind: 'corridor', polygon: square( 0, 0, 20, 2 ), doors: [] },
			{ id: 'f7-r1', kind: 'living', unit: 'f7-unit-1', polygon: square( 0, 2, 10, 10 ), doors: [] }
		] } } }
	}
};

/** A model that says each script's words in turn and never calls a tool; it keeps what it was asked. */
function sayingModel( ...replies ) {

	const seen = [];
	return {
		seen,
		async complete() { return 'A note.'; },
		async *stream( chat ) {

			seen.push( chat );
			yield { content: replies.shift() ?? 'Hm.' };

		}
	};

}

const servers = [];

/** The talk route on a local port over a served world of the fixture city, with `model` answering. */
async function talkServer( model ) {

	const root = await mkdtemp( join( tmpdir(), 'talk-actions-' ) );
	const dir = join( root, 'out', 'w' );
	await mkdir( join( dir, 'quests' ), { recursive: true } );
	await writeFile( join( dir, 'blueprint.json' ), JSON.stringify( FIXTURE_BLUEPRINT ) );
	await writeFile( join( dir, 'quests', 'questlines.json' ), '[]' );
	let mount, handler;
	talkRoute( root + sep, new TalkService( model, root + sep ) ).configureServer( { middlewares: { use( path, callback ) { mount = path; handler = callback; } } } );
	const server = createServer( ( request, response ) => {

		request.url = request.url.slice( mount.length ) || '/';
		handler( request, response, () => { response.statusCode = 404; response.end(); } );

	} );
	servers.push( server );
	await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
	return `http://127.0.0.1:${server.address().port}`;

}

/**
 * The game in a chat with the fixture city's day barista, who lives in
 * apartment 701: its companion, simulation and continuity are the fixture's,
 * its talk goes through the route to `model`, and closing the chat ends the
 * conversation in the continuity as the interactor does.
 */
async function chat( ...replies ) {

	const model = sayingModel( ...replies );
	const origin = await talkServer( model );
	const fetchHere = globalThis.fetch;
	vi.stubGlobal( 'fetch', ( url, init ) => fetchHere( typeof url === 'string' && url.startsWith( '/' ) ? origin + url : url, init ) );
	const world = setup();
	const barista = world.talkTo();
	const npc = world.bridge.getNPC( barista.npcId );
	const resident = { ...npc, home: { ...npc.home, apartment: { id: 'floor:7/f7-unit-1', floor: 7, number: '701' } } };
	const app = new GameApp( {} );
	app.clock = { timeMin: AFTERNOON };
	app.hitches = { time: ( name, run ) => run() };
	// The player stands with the person, out on the street.
	app.body = { feet: { x: barista.position[ 0 ], y: barista.position[ 1 ], z: barista.position[ 2 ] } };
	app.quests = { snapshot: () => [], dialoguesFor: () => [], conversationRecap: () => null, inventoryView: () => [], view: () => [] };
	app.questGameplay = { places: vi.fn( () => [] ), characterName: () => null };
	app.animations = { playerDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn() };
	app.companion = world.companion;
	app.npcContinuity = world.continuity;
	app.sim = { getNPC: ( id ) => id === npc.npcId ? resident : world.bridge.getNPC( id ), behaviorAt: ( id, timeMin ) => world.bridge.behaviorAt( id, timeMin ) };
	app.addresses = new AddressBook( { buildings: new Map( [ [ npc.home.parcelId, HOME_BLOCK ] ] ), nameOf: () => ( { name: 'Kessler Block' } ) } );
	app.playerAccess.book = app.addresses;
	app.playerPlaces = [];
	app.talk = new TalkClient( '/out/w' );
	const conversation = { npcId: npc.npcId, instance: resident, behavior: { mode: 'street', activity: 'leisure', place: { kind: 'parcel', id: 'p_cafe' }, interrupted: true } };
	app.interactor = {
		conversation,
		close: vi.fn( ( clock, reason, { keep } = {} ) => {

			app.interactor.conversation = null;
			world.continuity.endConversation( { timeMin: AFTERNOON, hold: keep } );

		} )
	};
	app.view.dialog.show( { name: TalkClient.nameOf( resident ) } );
	app.view.dialog.setTalkOpen( true );
	const events = [];
	for ( const type of [ 'contact-added', 'item-acquired', 'companion-started', 'companion-errand' ] ) app.events.addEventListener( type, ( event ) => events.push( { type, ...event.detail } ) );
	/** The chat closed, a frame of the companion runs: what it signalled. */
	const frame = () => {

		world.continuity.updateFollow( { timeMin: AFTERNOON, deltaSeconds: 1, playerPosition: barista.position } );
		app.updateCompanion( [ ...barista.position ], [] );
		return events;

	};
	return { app, world, npc, model, frame, events, say: ( line ) => app.sayLine( line ) };

}

describe( 'what a person agrees to in words happens', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

	} );

	afterEach( async () => {

		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		for ( const server of servers.splice( 0 ) ) {

			server.closeAllConnections();
			await new Promise( ( resolve ) => server.close( resolve ) );

		}

	} );

	it( 'follows the player once they say "Fine" to "come with me" and the chat closes', async () => {

		const { app, world, npc, frame, model, say } = await chat( 'Fine, you lead. Just keep your distance.' );
		await say( 'Come with me' );
		expect( model.seen[ 0 ].tools.map( ( tool ) => tool.function.name ) ).toContain( 'follow_player' );
		expect( app.interactor.close ).toHaveBeenCalled();
		expect( frame() ).toContainEqual( expect.objectContaining( { type: 'companion-started', npcId: npc.npcId, mode: 'follow' } ) );
		expect( world.companion.state ).toMatchObject( { npcId: npc.npcId, kind: 'follow' } );

	} );

	it( 'lets a person who follows the player hear what the player says to somebody else wherever they are, and keep it in their memory as overheard', async () => {

		const { app, world, npc, frame, model, say } = await chat( 'Fine, you lead.', 'Nobody since spring.', 'She said nobody has rented it since spring.' );
		await say( 'Come with me' );
		frame();
		expect( world.companion.state ).toMatchObject( { npcId: npc.npcId, kind: 'follow' } );
		// The player talks to the person's friend while the follower is along.
		const friend = world.bridge.getNPC( world.friend );
		app.interactor.conversation = { npcId: friend.npcId, instance: friend, behavior: { mode: 'street', activity: 'leisure', place: { kind: 'parcel', id: 'p_clinic' }, interrupted: true } };
		await say( 'Who rents 1407?' );
		app.interactor.conversation = { npcId: npc.npcId, instance: app.sim.getNPC( npc.npcId ), behavior: { mode: 'street', activity: 'leisure', place: { kind: 'parcel', id: 'p_cafe' }, interrupted: true } };
		await say( 'What did they say?' );
		const name = `${friend.name.given} ${friend.name.family}`;
		const note = new RegExp( `Overheard, not said to you: you were there when the player talked to ${name}, [^.]+\\. The player said: "Who rents 1407\\?" ${name} said: "Nobody since spring\\."` );
		expect( model.seen[ 2 ].messages[ 0 ].content ).toMatch( note );
		expect( model.seen[ 1 ].messages[ 0 ].content ).not.toContain( 'Overheard' );
		// It is the follower's own memory, which a save reads and keeps.
		const kept = ( await app.talk.memory() ).find( ( record ) => record.npcId === npc.npcId );
		expect( kept.memory.digest.some( ( text ) => note.test( text ) ) ).toBe( true );
		expect( kept.memory.heardAtMin ).toBe( AFTERNOON );

	} );

	it( 'lets a bystander in the same room hear the player and remember it as overheard, and nobody on another floor', async () => {

		const { app, npc, say } = await chat( 'Nobody since spring.' );
		const at = ( x, y, z ) => ( { x, y, z } );
		const feet = app.body.feet;
		// The player and the person stand in the cafe's dining room; upstairs is the office.
		const room = ( floor, y ) => ( { parcelId: 'p_cafe', floor, holds: ( p ) => Math.abs( p.x - feet.x ) < 12 && Math.abs( p.z - feet.z ) < 12 && Math.abs( p.y - y ) < 1.5 } );
		app.stream = { rooms: [ room( 0, feet.y ), room( 1, feet.y + 4 ) ] };
		app.standing = { parcelId: 'p_cafe' };
		app.crowd = { members: new Map( [
			[ 1, { npcId: 'a-diner', parcelId: 'p_cafe', position: at( feet.x + 9, feet.y, feet.z ) } ],
			[ 2, { npcId: 'a-upstairs', parcelId: 'p_cafe', position: at( feet.x + 1, feet.y + 4, feet.z ) } ],
			[ 3, { npcId: 'a-passer', parcelId: null, edge: true, position: at( feet.x + 3, feet.y, feet.z + 14 ) } ],
			[ 4, { npcId: npc.npcId, parcelId: 'p_cafe', position: at( feet.x + 1, feet.y, feet.z ) } ]
		] ) };
		await say( 'Who rents 1407?' );
		const memory = new Map( ( await app.talk.memory() ).map( ( record ) => [ record.npcId, record.memory ] ) );
		expect( memory.get( 'a-diner' ).digest ).toEqual( [ expect.stringMatching( /^Overheard, not said to you: you were there when the player talked to .+ The player said: "Who rents 1407\?" .+ said: "Nobody since spring\."$/ ) ] );
		expect( memory.has( 'a-upstairs' ) ).toBe( false );
		expect( memory.has( 'a-passer' ) ).toBe( false );
		// The person talked to remembers it as their own talk, not as overheard.
		expect( memory.get( npc.npcId ).digest ).toEqual( [] );
		expect( memory.get( npc.npcId ).turns.map( ( turn ) => turn.text ) ).toEqual( [ 'Who rents 1407?', 'Nobody since spring.' ] );

	} );

	it( 'lets a passer-by within earshot on the street hear the player, and nobody 20 m off or behind a wall', async () => {

		const { app, say } = await chat( 'Down the steps.' );
		const feet = app.body.feet;
		const at = ( dx, dz ) => ( { x: feet.x + dx, y: feet.y, z: feet.z + dz } );
		app.crowd = { members: new Map( [
			[ 1, { npcId: 'a-near', parcelId: null, position: at( 4, 3 ) } ],
			[ 2, { npcId: 'a-far', parcelId: null, edge: true, position: at( 20, 0 ) } ],
			[ 3, { npcId: 'a-inside', parcelId: 'p_cafe', position: at( 0, 5 ) } ],
			[ 4, { npcId: 'a-gone', parcelId: null, leaving: true, position: at( 1, 1 ) } ]
		] ) };
		await say( 'Where is the quay?' );
		const remembered = ( await app.talk.memory() ).map( ( record ) => record.npcId );
		expect( remembered ).toContain( 'a-near' );
		expect( remembered ).not.toContain( 'a-far' );
		expect( remembered ).not.toContain( 'a-inside' );
		expect( remembered ).not.toContain( 'a-gone' );

	} );

	it( 'leads the player home when they say "Fine, follow me" to "show me where you live"', async () => {

		const { app, world, npc, frame, model, say } = await chat( 'Fine, follow me. It is not far.' );
		await say( 'Show me where you live' );
		// The person knew how far their home lies, and that it is up a lift.
		expect( model.seen[ 0 ].messages[ 0 ].content ).toMatch( /- your home: about \d+ metres to the [a-z-]+, (?:a minute|\d+ minutes) on foot, then the lift up/ );
		expect( app.interactor.close ).toHaveBeenCalled();
		expect( frame() ).toContainEqual( expect.objectContaining( { type: 'companion-started', npcId: npc.npcId, mode: 'lead' } ) );
		expect( world.companion.state ).toMatchObject( { npcId: npc.npcId, kind: 'lead', destination: { relation: 'home', place: { id: npc.home.parcelId } } } );

	} );

	it( 'leads the player to the home the person offered when they answer "i follow you", not off on an errand of the person\'s own', async () => {

		const { app, world, npc, frame, say } = await chat(
			'Seventh floor, apartment 701. Want me to walk you there, or do you think you can navigate on your own?',
			'Fine. Keep up then. I\'m heading to that shop on the corner to kill some time.'
		);
		await say( 'Show me where you live' );
		expect( app.interactor.close ).not.toHaveBeenCalled();
		await say( 'i follow you' );
		expect( app.interactor.close ).toHaveBeenCalled();
		frame();
		expect( world.companion.state ).toMatchObject( { npcId: npc.npcId, kind: 'lead', destination: { relation: 'home' } } );

	} );

	it( 'walks to a place on their own when they agree to go there', async () => {

		const probe = await chat();
		const venue = probe.world.companion.talkOffers( probe.world.companion.offers( { npcId: probe.npc.npcId, timeMin: AFTERNOON, playerPlaces: [], wide: true } ), { npcId: probe.npc.npcId, timeMin: AFTERNOON } )
			.places.find( ( place ) => place.relation === 'venue' || place.relation === 'haunt' );
		vi.unstubAllGlobals();
		const { app, npc, frame, say } = await chat( 'Sure, I\'ll head over and wait.' );
		await say( `Can you go to ${venue.name} and wait for me there?` );
		expect( app.interactor.close ).toHaveBeenCalled();
		expect( frame() ).toContainEqual( expect.objectContaining( { type: 'companion-errand', npcId: npc.npcId, action: 'walk' } ) );

	} );

	it( 'gives the player their number when they say "Sure" to asking for it', async () => {

		const { app, npc, events, say } = await chat( 'Sure. Call me when you need me.' );
		await say( 'Can I have your number?' );
		expect( app.contacts.has( npc.npcId ) ).toBe( true );
		expect( events ).toContainEqual( expect.objectContaining( { type: 'contact-added', npcId: npc.npcId } ) );

	} );

	it( 'hands over a copy of their home\'s card when they say "Here" to asking for access', async () => {

		const { app, npc, events, say } = await chat( 'Here. Don\'t lose it.' );
		await say( 'Can you give me access to your apartment?' );
		const scope = `home:${npc.home.parcelId}/floor:7/f7-unit-1`;
		expect( app.items.has( cardId( scope ) ) ).toBe( true );
		expect( events ).toContainEqual( expect.objectContaining( { type: 'item-acquired', itemId: cardId( scope ), how: 'given' } ) );

	} );

} );
