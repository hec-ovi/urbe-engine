// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { Interactor } from './player/Interactor.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';
import { AddressBook } from './access/Addresses.js';
import { cardFor, cardId } from './access/Access.js';
import { GamePersistence } from './persistence/GamePersistence.js';
import gameFixture from '../library/fixtures/out/games/night-shift/game.json';

const square = ( x0, z0, x1, z1 ) => [ [ x0, z0 ], [ x1, z0 ], [ x1, z1 ], [ x0, z1 ] ];
/** A home block's fourteenth floor: apartment 1407 off its corridor. */
const HOME_BLOCK = {
	interior: {
		building: { floors: [ { index: 14, layout: 'middle', elevation: 56, openings: {}, apartmentEntrances: [
			{ unit: 'f14-home-7', number: '1407', position: [ 5, 2 ], inward: [ 0, 1 ], width: 1.6 }
		] } ] },
		layouts: { middle: { floor: { kind: 'apartment', rooms: [
			{ id: 'f14-corridor', kind: 'corridor', polygon: square( 0, 0, 20, 2 ), doors: [] },
			{ id: 'f14-r1', kind: 'living', unit: 'f14-home-7', polygon: square( 0, 2, 10, 10 ), doors: [] }
		] } } }
	}
};

describe( 'playable game navigation', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();

	} );

	afterEach( () => {

		vi.useRealTimers();
		vi.restoreAllMocks();

	} );

	it( 'returns a direct preview to the real launcher from the Leave control', async () => {

		const navigate = vi.fn();
		const app = new GameApp( {}, { navigate } );
		app.view.setPaused( true );

		await userEvent.setup().click( screen.getByRole( 'button', { name: /leave/i } ) );

		expect( navigate ).toHaveBeenCalledOnce();
		expect( navigate ).toHaveBeenCalledWith( '/' );

	} );

	it( 'saves the quest scenery, the quest escort, the companion and what people remember beside the continuity, and keeps the saved memory when it cannot be read', async () => {

		const navigate = vi.fn();
		const { app, escort, companion, scenery } = savingApp( { navigate } );
		app.talk = { memory: vi.fn( async () => MEMORY ) };
		app.view.setPaused( true );
		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: /leave/i } ) );
		await vi.waitFor( () => expect( navigate ).toHaveBeenCalledWith( '/' ) );
		expect( app.persistence.save.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			scenery,
			npcState: { timeMin: 725, simulation: { sim: true }, continuity: { continuity: true }, questEscort: escort, companion },
			dialogueMemory: MEMORY
		} );

		app.talk.memory.mockRejectedValueOnce( new Error( 'talk 502' ) );
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		app.questNpcControl( { kind: 'start-follow', npcId: 'npc-kip' } );
		await vi.waitFor( () => expect( app.persistence.save ).toHaveBeenCalledTimes( 2 ) );
		expect( app.persistence.save.mock.calls[ 1 ][ 0 ] ).not.toHaveProperty( 'dialogueMemory' );
		expect( console.warn ).toHaveBeenCalledWith( 'dialogue memory not saved:', 'talk 502' );

	} );

	it( 'saves a given card, the regard of a person who caught a theft, contacts and memory through the real save schema when a talk ends, a reload takes them back, and a refused save names its field in a toast', async () => {

		const sent = [];
		const fetcher = vi.fn( async ( url, options ) => {

			const input = JSON.parse( options.body ).input;
			sent.push( input );
			const carried = Object.fromEntries( [ 'npcState', 'scenery', 'dialogueMemory', 'contacts', 'access' ].filter( ( key ) => key in input ).map( ( key ) => [ key, input[ key ] ] ) );
			return { ok: true, status: 200, json: async () => ( {
				...gameFixture, player: input.player, quests: input.quests, sideJobs: input.sideJobs,
				currentLocation: input.currentLocation, discoveredLocations: input.discoveredLocations, ...carried,
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} ) };

		} );
		const { app } = savingApp();
		app.persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: gameFixture.id, fetcher } );
		app.quests = { persistenceView: () => [], inventoryView: () => [] };
		app.sim = { serialize: () => ( { version: '1', seed: 'fixture-seed', events: [] } ) };
		app.npcContinuity = { serialize: () => ( { version: '2', actors: [], follow: null, returns: [], conversation: null } ) };
		app.companion.accepted = () => false;
		app.transitGameplay = { state: { status: 'waiting', clock: { dayOffset: 0, lastDaySeconds: 43500 } } };
		app.playStartedAt = performance.now();
		app.talk = { memory: vi.fn( async () => MEMORY ) };
		const book = new AddressBook( { buildings: new Map(), nameOf: () => ( { name: 'Kessler Block' } ) } );
		const scope = 'home:p1724/floor:7/f7-unit-1';
		app.items.add( cardFor( scope, { book, issuer: { npcId: 'a59987', name: 'Pearl Vance' }, how: 'given', atMin: 1101 } ) );
		app.items.add( cardFor( 'homes:p1724', { book, issuer: { npcId: 'a103907', name: 'Lane Ito' }, how: 'stolen', atMin: 1102 } ) );
		app.regard.drop( 'a103907', 1102 );
		app.contacts.add( 'a59987', 1101 );

		// The talk ends: a moment later the game saves on its own.
		app.conversationShown = { npcId: 'a59987', instance: { npcId: 'a59987' } };
		app.presentConversation( null );
		await vi.waitFor( () => expect( fetcher ).toHaveBeenCalledOnce(), { timeout: 4000 } );
		const saved = await app.persistence.pending;

		// A reload takes the cards, the regard and the memory back.
		const reloaded = new GamePersistence( { game: JSON.parse( JSON.stringify( saved ) ), gameId: gameFixture.id, fetcher } );
		const back = new GameApp( {} );
		back.items.restore( reloaded.game.player.inventory );
		back.regard.restore( reloaded.game.access.regard );
		expect( back.items.get( cardId( scope ) ).data ).toMatchObject( { grants: [ scope ], issuer: { npcId: 'a59987', name: 'Pearl Vance' }, how: 'given' } );
		expect( back.items.has( cardId( 'homes:p1724' ) ) ).toBe( true );
		expect( back.regard.adjust( 'friendly', 'a103907' ) ).not.toBe( 'friendly' );
		expect( reloaded.game.dialogueMemory ).toEqual( MEMORY );
		expect( reloaded.game.contacts ).toEqual( [ { npcId: 'a59987', addedMin: 1101 } ] );

		// A save the schema refuses says so, with the field it failed on.
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		app.items.add( { id: 'Bad Id', kind: 'access-card', label: 'Odd card', data: {} } );
		app.conversationShown = { npcId: 'a59987', instance: { npcId: 'a59987' } };
		app.presentConversation( null );
		await vi.waitFor( () => expect( screen.getByText( /live game state does not match its schema: \/inventory\/\d+\/id must match pattern/ ) ).toBeTruthy(), { timeout: 4000 } );
		expect( screen.getAllByText( 'Save failed' ).length ).toBeGreaterThan( 0 );
		expect( fetcher ).toHaveBeenCalledOnce();

	} );

	it( 'turns NPC voices on and off and sets their volume from the settings', async () => {

		const app = new GameApp( {} );
		app.voice = { setEnabled: vi.fn(), setVolume: vi.fn() };
		app.view.open( 'SETTINGS' );
		await userEvent.setup().selectOptions( screen.getByLabelText( 'NPC voices', { selector: 'select' } ), 'off' );
		fireEvent.input( screen.getByLabelText( 'Voice volume' ), { target: { value: '0.3' } } );
		expect( app.voice.setEnabled ).toHaveBeenCalledExactlyOnceWith( false );
		expect( app.voice.setVolume ).toHaveBeenCalledExactlyOnceWith( 0.3 );

		// The chat's voices toggle shows the same setting and changes it.
		app.view.close();
		app.view.dialog.show( { name: 'Ada Vance' } );
		app.view.dialog.setTalkOpen( true );
		const toggle = screen.getByRole( 'button', { name: 'NPC voices', pressed: false } );
		await userEvent.setup().click( toggle );
		expect( app.voice.setEnabled ).toHaveBeenLastCalledWith( true );
		expect( toggle.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( screen.getByLabelText( 'NPC voices', { selector: 'select' } ).value ).toBe( 'on' );

	} );

	it( 'sends a typed line, renders the reply through the dialogue lifecycle, and stays usable after a model failure', async () => {

		const app = dialogueApp();
		const user = userEvent.setup();
		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		await user.type( input, 'where is the quay?{Enter}' );

		await vi.waitFor( () => expect( within( app.view.dialog.transcript ).getByText( 'Down the steps.' ) ).toBeTruthy() );
		// A typed line may get the person's number, while the player lacks it.
		expect( app.talk.stream ).toHaveBeenCalledExactlyOnceWith( app.interactor.conversation, 'where is the quay?', 725, [], { signal: expect.any( AbortSignal ), offers: { contact: true } } );
		expect( app.animations.playerDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.npcDialogueTurn ).toHaveBeenCalledOnce();
		expect( app.animations.completeDialogueTurn ).not.toHaveBeenCalled();
		expect( app.questGameplay.places ).not.toHaveBeenCalled();

		app.talk.stream.mockImplementationOnce( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
		await user.type( input, 'second line{Enter}' );
		await vi.waitFor( () => expect( screen.getByText( /reply could not be reached/ ) ).toBeTruthy() );
		expect( app.animations.completeDialogueTurn ).toHaveBeenCalledOnce();

		await user.type( input, 'third line{Enter}' );
		await vi.waitFor( () => expect( within( app.view.dialog.transcript ).getAllByText( 'Down the steps.' ) ).toHaveLength( 2 ) );
		expect( app.talk.stream ).toHaveBeenCalledTimes( 3 );
		expect( input.disabled ).toBe( false );

	} );

	it( 'asks for a number from the chat: the reply decides it and the book keeps them; with no reply a wary person declines', async () => {

		const app = dialogueApp();
		const conversation = app.interactor.conversation;
		app.quests = { snapshot: () => [], dialoguesFor: () => [], conversationRecap: () => null };
		app.talk.remembered = async () => [];
		app.companion.accepted = () => false;
		app.talk.stream.mockImplementationOnce( () => talkStream( [ ...replyEvents( 'Sure. Here.' ).slice( 0, 2 ), { type: 'offer', kind: 'contact' }, { type: 'done', reply: 'Sure. Here.' } ] ) );
		app.presentConversation( conversation );
		const user = userEvent.setup();

		await user.click( screen.getAllByRole( 'button', { name: 'Can I have your number?' } )[ 0 ] );
		await vi.waitFor( () => expect( app.contacts.has( 'npc-ada' ) ).toBe( true ) );
		expect( app.talk.stream ).toHaveBeenLastCalledWith( conversation, 'Can I have your number?', 725, [], { signal: expect.any( AbortSignal ), offers: { contact: true } } );
		expect( app.contacts.serialize() ).toEqual( [ { npcId: 'npc-ada', addedMin: 725 } ] );
		expect( screen.getByText( 'Added to your contacts. Call them from Contacts (P).' ) ).toBeTruthy();
		expect( screen.queryAllByRole( 'button', { name: 'Can I have your number?' } ) ).toHaveLength( 0 );
		// The answer to the chosen action is said where the eye is, the talk window closed: in the subtitle.
		expect( app.view.dialog.talkOpen ).toBe( false );
		expect( app.view.dialog.sayAccessible.textContent ).toBe( 'Sure. Here.' );
		// The new contact is announced as one, and set apart in the conversation.
		expect( app.view.toast.element.querySelector( '.toast.is-contact .toast-kicker' ).textContent ).toBe( 'NEW CONTACT' );
		expect( within( app.view.dialog.transcript ).getByText( 'New contact' ).parentElement.textContent ).toBe( 'New contactAda Vance' );

		// Nobody can answer for a wary stranger: they keep their number.
		const wary = { ...conversation, npcId: 'npc-kip', instance: { ...conversation.instance, npcId: 'npc-kip', name: { given: 'Kip', family: 'Marr' }, traits: [ 'wary' ] } };
		app.sim = { getNPC: () => wary.instance };
		app.companion.categoryOf = () => 'service';
		app.talk.stream.mockImplementationOnce( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
		app.interactor.conversation = wary;
		app.presentConversation( wary );
		await user.click( screen.getAllByRole( 'button', { name: 'Can I have your number?' } )[ 0 ] );
		await vi.waitFor( () => expect( within( app.view.dialog.transcript ).getByText( /^(I don't hand my number to strangers\.|I don't know you\. No\.)$/ ) ).toBeTruthy() );
		expect( app.contacts.has( 'npc-kip' ) ).toBe( false );
		expect( screen.getAllByRole( 'button', { name: 'Can I have your number?' } ).length ).toBeGreaterThan( 0 );

	} );

	it( 'asks for access from the chat: the reply hands over a copy of the card, the inventory and the save keep it; with no reply only a friendly person gives their home\'s', async () => {

		const app = dialogueApp();
		const conversation = app.interactor.conversation;
		app.addresses = new AddressBook( { buildings: new Map( [ [ 'p-homes', HOME_BLOCK ] ] ), nameOf: () => ( { name: 'Kessler Block' } ) } );
		app.playerAccess.book = app.addresses;
		conversation.instance.home = { parcelId: 'p-homes', unit: 1, apartment: { id: 'floor:14/f14-home-7', floor: 14, number: '1407' } };
		app.sim = { getNPC: () => conversation.instance };
		app.quests = { snapshot: () => [], dialoguesFor: () => [], conversationRecap: () => null, inventoryView: () => [], view: () => [] };
		app.questItemIds = [];
		app.talk.remembered = async () => [];
		app.companion.accepted = () => false;
		app.contacts.add( 'npc-ada', 700 );
		const scope = 'home:p-homes/floor:14/f14-home-7';
		app.talk.stream.mockImplementationOnce( () => talkStream( [
			...replyEvents( 'Here. Don\'t lose it.' ).slice( 0, 2 ),
			{ type: 'offer', kind: 'give', itemId: `card:${scope}`, name: 'Kessler Block 1407 key card' },
			{ type: 'done', reply: 'Here. Don\'t lose it.' }
		] ) );
		app.presentConversation( conversation );
		const user = userEvent.setup();

		await user.click( screen.getAllByRole( 'button', { name: 'Can you give me access to your apartment?' } )[ 0 ] );
		await vi.waitFor( () => expect( app.items.has( cardId( scope ) ) ).toBe( true ) );
		// The talk asked that card alone, by what the player reads it as.
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].offers ).toEqual( { give: { items: [ { itemId: `card:${scope}`, name: 'Kessler Block 1407 key card, which opens Kessler Block, floor 14, apartment 1407' } ] } } );
		// The person's home, work and cards by address went with it.
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].addresses ).toEqual( {
			home: { parcelId: 'p-homes', floor: 14, unit: 'apartment 1407' }, access: [ { parcelId: 'p-homes', opens: 'apartment 1407', tie: 'home' } ]
		} );
		// The card is announced where the eye is, with its picture's tile, and set apart in the conversation.
		const notice = app.view.toast.element.querySelector( '.toast.is-item' );
		expect( notice.querySelector( '.toast-kicker' ).textContent ).toBe( 'ITEM ACQUIRED' );
		expect( notice.querySelector( '.toast-title' ).textContent ).toBe( 'Kessler Block 1407 key card' );
		expect( notice.querySelector( '.toast-tile' ) ).toBeTruthy();
		expect( within( app.view.dialog.transcript ).getByText( 'Item acquired' ).parentElement.textContent ).toBe( 'Item acquiredKessler Block 1407 key card' );
		expect( screen.queryAllByRole( 'button', { name: 'Can you give me access to your apartment?' } ) ).toHaveLength( 0 );
		expect( app.items.get( cardId( scope ) ).data ).toMatchObject( { grants: [ scope ], issuer: { npcId: 'npc-ada', name: 'Ada Vance' }, how: 'given' } );
		const door = { role: 'apartment', parcelId: 'p-homes', floor: 14, unit: 'f14-home-7', center: { x: 5, y: 56, z: 2 }, inward: [ 0, 1 ] };
		expect( app.playerAccess.lockOf( door, { x: 5, z: 1 } ).locked ).toBe( false );

		// The inventory reads the card's issuer and what it opens.
		app.view.open( 'INVENTORY' );
		await user.click( screen.getAllByRole( 'button', { name: 'Kessler Block 1407 key card' } )[ 0 ] );
		expect( screen.getAllByText( 'Ada Vance' ).length ).toBeGreaterThan( 0 );
		expect( screen.getAllByText( 'Kessler Block, floor 14, apartment 1407' ).length ).toBeGreaterThan( 0 );
		app.view.close();

		// Nobody can answer for a wary stranger: they keep their card; a friendly one hands over their home's.
		app.items.remove( cardId( scope ) );
		for ( const [ traits, given ] of [ [ [ 'wary' ], false ], [ [ 'warm', 'kind' ], true ] ] ) {
			conversation.instance.traits = traits;
			app.talk.stream.mockImplementationOnce( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
			app.presentConversation( conversation );
			await user.click( screen.getAllByRole( 'button', { name: 'Can you give me access to your apartment?' } )[ 0 ] );
			await vi.waitFor( () => expect( app.dialoguePending ).toBe( false ) );
			expect( app.items.has( cardId( scope ) ) ).toBe( given );
		}

	} );

	it( 'rings a contact from the contacts screen and talks to them over the phone, with nobody\'s body moved', async () => {

		const app = dialogueApp();
		const conversation = app.interactor.conversation;
		app.interactor = new Interactor( { crowd: { within: () => [], memberForNpc: () => null }, doors: [], sim: {}, controller: {} } );
		app.interactor.onConversation = ( opened ) => app.presentConversation( opened );
		app.quests = { snapshot: () => [], dialoguesFor: () => [], conversationRecap: () => null, characterName: () => null };
		app.talk.remembered = async () => [];
		app.sim = { getNPC: () => conversation.instance, behaviorAt: () => ( { activity: 'leisure', mode: 'street' } ) };
		app.companion = { ...app.companion, categoryOf: () => 'service', accepted: () => false };
		app.body = { feet: { x: 1, y: 0, z: 2 } };
		app.locator = { location: () => ( { id: 'p1', name: 'Quay' } ), parcelById: new Map(), district: () => 'Old Quay' };
		app.acquaintances.met( 'npc-ada', { name: 'Ada Vance', role: 'Clerk', place: 'Salt Wharf', timeMin: 700 } );
		app.contacts.add( 'npc-ada', 700 );

		app.view.open( 'CONTACTS' );
		const user = userEvent.setup();
		await user.click( screen.getAllByRole( 'button', { name: 'Call Ada Vance' } ).at( - 1 ) );
		expect( app.view.panels.current ).toBeNull();
		expect( screen.getByRole( 'region', { name: 'Call with Ada Vance' } ) ).toBeTruthy();
		expect( app.view.call.element.dataset.status ).toBe( 'connecting' );

		app.phone.update( 3 );
		expect( app.interactor.conversation ).toMatchObject( { npcId: 'npc-ada', call: true, person: null } );
		expect( within( app.view.dialog.transcript ).getByText( /^(Hello\?|Yeah\? I'm here\.|Hey\. What is it\?)$/ ) ).toBeTruthy();
		expect( screen.getAllByRole( 'button', { name: 'Can you meet me here?' } ).length ).toBeGreaterThan( 0 );

		const input = screen.getByRole( 'textbox', { name: 'say something' } );
		await user.type( input, 'where are you?{Enter}' );
		await vi.waitFor( () => expect( app.talk.stream ).toHaveBeenCalledOnce() );
		expect( app.talk.stream.mock.calls[ 0 ][ 4 ] ).toMatchObject( { call: { caller: 'player' }, offers: { meet: { name: 'Quay' } } } );

		// The chat's own End call ends it as the call screen's does.
		expect( within( app.view.dialog.element ).getByRole( 'button', { name: 'End call' } ) ).toBeTruthy();
		await user.click( within( app.view.call.element ).getByRole( 'button', { name: 'End call' } ) );
		expect( app.interactor.conversation ).toBeNull();
		expect( app.view.call.element.dataset.status ).toBe( 'ended' );

	} );

	it( 'waits as long as a reply keeps arriving, then gives it up 90 s after it goes quiet, leaving no part of it and offering Retry', async () => {

		vi.useFakeTimers();
		const app = dialogueApp();
		app.talk.stream.mockImplementationOnce( ( conversation, line, timeMin, quests, { signal } ) => talkStream( [
			{ type: 'delta', text: 'Down the' },
			new Promise( ( resolve ) => setTimeout( () => resolve( { type: 'delta', text: ' steps' } ), 60000 ) ),
			new Promise( ( resolve, reject ) => signal.addEventListener( 'abort', () => reject( signal.reason ) ) )
		] ) );
		const said = app.sayLine( 'where is the quay?' );
		await vi.advanceTimersByTimeAsync( 120000 );
		expect( app.view.dialog.transcript.lastElementChild.textContent ).toBe( 'Ada VanceDown the steps' );
		expect( console.warn ).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync( 30000 );
		await said;
		expect( [ ...app.view.dialog.transcript.children ].map( ( line ) => line.textContent ) ).toEqual( [ 'Youwhere is the quay?' ] );
		expect( screen.getByRole( 'button', { name: 'Retry reply' } ) ).toBeTruthy();
		expect( console.warn ).toHaveBeenCalledWith( 'talk:', 'no reply for 90 s' );

	} );

} );

const MEMORY = [ { npcId: 'npc-ada', memory: { digest: [ 'Asked about the quay.' ], turns: [] } } ];

/** A game that saves: its parts give what the save carries, and a quest control saves it. */
function savingApp( options ) {

	const app = new GameApp( {}, options );
	const escort = { questId: 'q1', stepId: 's1', npcId: 'npc-kip', mode: 'lead-player' };
	const companion = { version: '1', npcId: 'npc-ada', kind: 'follow', startedAtMin: 700, phase: 'walking' };
	const scenery = [ { contractVersion: '1.0', sceneId: 'q1.sc_quay', status: 'retired', stagedAtMin: 610, retiredAtMin: 700 } ];
	app.persistence = { game: { quests: [], sideJobs: [] }, save: vi.fn( async () => ( {} ) ) };
	app.body = { feet: { x: 1, y: 2, z: 3 } };
	app.controller = { yaw: 0.5 };
	app.clock = { timeMin: 725 };
	app.locator = { location: () => ( { id: 'p1', name: 'Quay' } ) };
	app.discoveredLocations = new Map();
	app.savedInventory = [];
	app.questItemIds = [];
	app.quests = { persistenceView: () => [], inventoryView: () => [] };
	app.transitGameplay = { state: null };
	app.questGameplay = { serializeTransit: () => null, serializeEscort: () => escort, control: () => ( { ok: true } ) };
	app.investigations = { serialize: () => [] };
	app.scenery = { serialize: () => scenery };
	app.sim = { serialize: () => ( { sim: true } ) };
	app.npcContinuity = { serialize: () => ( { continuity: true } ) };
	app.companion = { serialize: () => companion };
	return { app, escort, companion, scenery };

}

function dialogueApp() {

	const app = new GameApp( {} );
	const conversation = {
		npcId: 'npc-ada',
		instance: {
			npcId: 'npc-ada', name: { given: 'Ada', family: 'Vance' }, type: 'clerk',
			home: { parcelId: 'p1', unit: 2 }, routine: []
		},
		behavior: null
	};
	app.clock = { timeMin: 725 };
	app.quests = { snapshot: () => [] };
	app.questGameplay = { places: vi.fn( () => [] ) };
	app.animations = {
		playerDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn()
	};
	app.talk = { stream: vi.fn( () => talkStream( replyEvents( 'Down the ', 'steps.' ) ) ), said: vi.fn() };
	app.companion = { offers: () => [], talkOffers: () => null, guide: () => null };
	app.interactor = {
		conversation,
		close: vi.fn( () => { app.interactor.conversation = null; } )
	};
	app.view.dialog.show( { name: 'Ada Vance' } );
	app.view.dialog.setTalkOpen( true );
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	return app;

}
