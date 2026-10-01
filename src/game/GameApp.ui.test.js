// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { Interactor } from './player/Interactor.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';

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
