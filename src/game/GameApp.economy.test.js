// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../ui/test-helpers/canvas.js';
import { GameApp } from './GameApp.js';
import { replyEvents, talkError, talkStream } from './talk/talk.test-fixtures.js';
import { AddressBook } from './access/Addresses.js';
import { Economy, carryOf, goodsItem, menuOf } from './economy/index.js';
import { GamePersistence } from './persistence/GamePersistence.js';
import gameFixture from '../library/fixtures/out/games/night-shift/game.json';
import * as dialogRuntime from '../../../quests/dist/runtime.js';

/** A Quests build that reads credits held out and refusals in words. */
const words = typeof dialogRuntime.heldOut === 'function' && typeof dialogRuntime.stanceOf === 'function';

/** Ada waits tables at a rich bar and lives in a mid block. */
const ADA = {
	npcId: 'npc-ada', name: { given: 'Ada', family: 'Vance' }, type: 'waiter', age: 41, traits: [], family: [],
	home: { parcelId: 'p1', unit: 2 }, job: { parcelId: 'p-bar', role: 'waiter' }, routine: []
};
const PARCELS = [
	{ id: 'p1', type: 'residential', tier: 'mid' }, { id: 'p-bar', type: 'restaurant', tier: 'rich', name: 'Wren\'s' },
	{ id: 'p-police', type: 'police', tier: 'rich' }
];

/**
 * A game in a talk with Ada, with the servers' answers `gate` and, while
 * saves are on, an economy whose people carry what Carry works out.
 */
function tradingApp( { gate = { saves: true, talk: true }, working = false, standing = null, person = {} } = {} ) {

	const app = new GameApp( {} );
	const instance = { ...structuredClone( ADA ), ...person };
	const conversation = { npcId: instance.npcId, instance, behavior: null };
	app.clock = { timeMin: 725 };
	app.sim = {
		getNPC: ( id ) => {

			if ( id !== instance.npcId ) throw new Error( `${id} is not instanced` );
			return instance;

		},
		behaviorAt: () => ( { activity: working ? 'working' : 'leisure' } ), findNPCs: () => []
	};
	app.quests = {
		snapshot: () => [], dialoguesFor: () => [], conversationRecap: () => null, inventoryView: () => [], view: () => [], handable: () => null, settlements: () => []
	};
	app.questItemIds = [];
	app.savedInventory = [];
	app.questGameplay = { places: vi.fn( () => [] ), characterName: () => null };
	app.animations = { playerDialogueTurn: vi.fn(), npcDialogueTurn: vi.fn(), completeDialogueTurn: vi.fn() };
	app.talk = { stream: vi.fn( () => talkStream( replyEvents( 'Fine.' ) ) ), said: vi.fn(), remembered: async () => [] };
	app.companion = {
		offers: () => [], talkOffers: () => null, guide: () => null, accepted: () => false, categoryOf: () => 'resident',
		acceptFromTool: vi.fn( () => ( { ok: true, npcId: instance.npcId, kind: 'follow', line: 'Come on, then.' } ) )
	};
	app.interactor = { conversation, close: vi.fn( () => { app.interactor.conversation = null; } ) };
	app.addresses = new AddressBook( { buildings: new Map(), nameOf: () => ( { name: 'Kessler Block' } ) } );
	app.playerAccess.book = app.addresses;
	app.atlasParcels = new Map( PARCELS.map( ( parcel ) => [ parcel.id, parcel ] ) );
	app.venues = { nameOf: ( id ) => id === 'p-bar' ? 'Wren\'s' : null };
	app.standing = standing;
	app.economyGate = gate;
	if ( gate.saves ) {

		app.economy = Economy.restore( undefined, {
			timeMin: 725, base: ( id ) => id === instance.npcId ? carryOf( instance, { tier: 'mid' } ) : null,
			items: app.items, now: () => app.clock.timeMin, nameOf: () => 'Ada Vance'
		} );

	}
	vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	return { app, conversation, instance };

}

/** The talk opens with Ada and its window to type in. */
const talkTo = ( app, conversation ) => {

	app.presentConversation( conversation );
	app.view.dialog.setTalkOpen( true );

};
const row = () => within( screen.getByRole( 'group', { name: 'Ask Ada Vance along' } ) );
const names = () => row().getAllByRole( 'button' ).map( ( button ) => button.textContent );
const transcript = ( app ) => [ ...app.view.dialog.transcript.children ].map( ( line ) => {
	const title = line.querySelector( '.chat-note-text > span:last-child' );
	return ( title ?? line.lastElementChild ).textContent;
} );
const toast = ( app, kind ) => app.view.toast.element.querySelector( `.toast.is-${kind} .toast-title` )?.textContent ?? null;

describe( 'credits and things changing hands in a talk', () => {

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();

	} );

	afterEach( () => {

		vi.useRealTimers();
		vi.restoreAllMocks();

	} );

	it( 'plays as before while neither server takes credits: no wallet, no trade actions, nothing carried in a talk', async () => {

		const { app, conversation } = tradingApp( { gate: { saves: false, talk: false } } );
		talkTo( app, conversation );
		app.itemAcquired();
		expect( app.view.clock.element.querySelector( '.hud-clock-credits' ).hidden ).toBe( true );
		expect( screen.queryByRole( 'button', { name: 'Hand over…' } ) ).toBeNull();
		await userEvent.setup().type( within( app.view.dialog.element ).getByRole( 'textbox' ), 'Here are 10 credits.{Enter}' );
		await vi.waitFor( () => expect( app.dialoguePending ).toBe( false ) );
		const context = app.talk.stream.mock.calls.at( - 1 )[ 4 ];
		expect( context.carry ).toBeUndefined();
		expect( context.offers?.credits ).toBeUndefined();

	} );

	it( 'shows the wallet once the launcher saves it, but keeps transfers out of a talk the talk route cannot take', async () => {

		const { app, conversation } = tradingApp( { gate: { saves: true, talk: false } } );
		talkTo( app, conversation );
		app.itemAcquired();
		const chip = app.view.clock.element.querySelector( '.hud-clock-credits' );
		expect( chip.hidden ).toBe( false );
		expect( chip.textContent ).toBe( '40 cr' );
		expect( screen.queryByRole( 'button', { name: 'Hand over…' } ) ).toBeNull();
		await userEvent.setup().type( within( app.view.dialog.element ).getByRole( 'textbox' ), 'hello{Enter}' );
		await vi.waitFor( () => expect( app.dialoguePending ).toBe( false ) );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].carry ).toBeUndefined();

	} );

	it( 'tells a talk what the person carries and hands one of the player\'s things over when they take it, with a notice and a chat line', async () => {

		const { app, conversation } = tradingApp();
		app.items.stack( goodsItem( { goodId: 'whisky', name: 'glass of whisky', price: 18 }, { name: 'Wren\'s', parcelId: 'p-bar' }, 700 ) );
		const trades = [];
		app.events.addEventListener( 'trade', ( event ) => trades.push( event.detail ) );
		talkTo( app, conversation );
		const user = userEvent.setup();
		expect( names() ).toContain( 'Hand over…' );
		await user.click( row().getByRole( 'button', { name: 'Hand over…' } ) );
		expect( names() ).toEqual( [ 'Glass of whisky', '5 cr', '10 cr', '20 cr', 'Back' ] );
		app.talk.stream.mockImplementationOnce( () => talkStream( [
			...replyEvents( 'For me? All right.' ).slice( 0, 2 ),
			{ type: 'offer', kind: 'take', itemId: 'own:goods-whisky', name: 'Glass of whisky' },
			{ type: 'done', reply: 'For me? All right.' }
		] ) );
		await user.click( row().getByRole( 'button', { name: 'Glass of whisky' } ) );
		await vi.waitFor( () => expect( app.items.has( 'goods-whisky' ) ).toBe( false ) );
		const [ , line, , , context ] = app.talk.stream.mock.calls.at( - 1 );
		expect( line ).toBe( 'Here, this is for you: Glass of whisky.' );
		expect( context.offers ).toEqual( { take: { items: [ { itemId: 'own:goods-whisky', name: 'Glass of whisky' } ] } } );
		const carried = carryOf( ADA, { tier: 'mid' } );
		expect( context.carry ).toMatchObject( { credits: carried.credits, means: carried.means } );
		expect( context.carry.items.length ).toBeGreaterThan( 0 );
		expect( toast( app, 'given' ) ).toBe( 'Glass of whisky handed to Ada Vance' );
		expect( within( app.view.dialog.transcript ).getByText( 'Handed over' ).parentElement.textContent ).toBe( 'Handed overGlass of whisky handed to Ada Vance' );
		expect( app.economy.holdings.of( 'npc-ada' ).got ).toEqual( [ { id: 'goods-whisky', name: 'Glass of whisky', kind: 'goods', atMin: 725 } ] );
		expect( trades ).toEqual( [ { npcId: 'npc-ada', kind: 'given', name: 'Glass of whisky' } ] );
		// What they took is in what they carry from then on, as something a stranger gave them.
		app.talk.stream.mockImplementationOnce( () => talkStream( replyEvents( 'It was kind of you.' ) ) );
		await user.type( within( app.view.dialog.element ).getByRole( 'textbox' ), 'Do you like it?{Enter}' );
		await vi.waitFor( () => expect( app.dialoguePending ).toBe( false ) );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].carry.items ).toContainEqual( { name: 'Glass of whisky', from: 'stranger', atMin: 725 } );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].carry.dealings ).toEqual( [ { what: 'got-thing', name: 'Glass of whisky', atMin: 725 } ] );

	} );

	it( 'commits every action in one reply: credits taken and the person coming along', async () => {

		const { app, conversation } = tradingApp();
		talkTo( app, conversation );
		const user = userEvent.setup();
		const before = app.economy.holdings.of( 'npc-ada' ).credits;
		await user.click( row().getByRole( 'button', { name: 'Hand over…' } ) );
		app.talk.stream.mockImplementationOnce( () => talkStream( [
			...replyEvents( 'Thank you. Come on, then.' ).slice( 0, 2 ),
			{ type: 'offer', kind: 'accept', amount: 10 }, { type: 'offer', kind: 'follow' }, { type: 'offer', kind: 'accept', amount: 10 },
			{ type: 'done', reply: 'Thank you. Come on, then.' }
		] ) );
		await user.click( row().getByRole( 'button', { name: '10 cr' } ) );
		await vi.waitFor( () => expect( app.interactor.close ).toHaveBeenCalled() );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 1 ] ).toBe( 'Here, 10 credits.' );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].offers ).toEqual( { credits: { carried: before, purse: 40, offered: 10 } } );
		// The same sum twice in one reply is taken once.
		expect( app.economy.wallet.credits ).toBe( 30 );
		expect( app.economy.holdings.of( 'npc-ada' ).credits ).toBe( before + 10 );
		expect( toast( app, 'paid' ) ).toBe( '−10 cr paid to Ada Vance' );
		expect( app.companion.acceptFromTool ).toHaveBeenCalledExactlyOnceWith( expect.objectContaining( { npcId: 'npc-ada', kind: 'follow' } ) );

	} );

	it( 'takes credits held out by disposition when nobody answers, and an official refuses a bribe and notes it', async () => {

		const friendly = tradingApp( { person: { traits: [ 'warm', 'kind' ] } } );
		talkTo( friendly.app, friendly.conversation );
		const user = userEvent.setup();
		friendly.app.talk.stream.mockImplementation( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
		await user.click( row().getByRole( 'button', { name: 'Hand over…' } ) );
		await user.click( row().getByRole( 'button', { name: '5 cr' } ) );
		await vi.waitFor( () => expect( friendly.app.economy.wallet.credits ).toBe( 35 ) );

		document.body.replaceChildren();
		const { app, conversation } = tradingApp( { person: { traits: [ 'suspicious', 'stern' ], job: { parcelId: 'p-police', role: 'security' } } } );
		talkTo( app, conversation );
		app.talk.stream.mockImplementation( () => talkStream( [], talkError( 'model unavailable', 502 ) ) );
		await user.click( row().getByRole( 'button', { name: 'Hand over…' } ) );
		await user.click( row().getByRole( 'button', { name: '20 cr' } ) );
		await vi.waitFor( () => expect( app.regard.of( 'npc-ada' ) ).toBeTruthy() );
		expect( app.economy.wallet.credits ).toBe( 40 );
		expect( transcript( app ).at( - 1 ) ).toMatch( /Put that away|note that you offered|Put it away/ );
		expect( app.view.toast.element.textContent ).toContain( 'Ada Vance noted your offer.' );
		expect( app.economy.holdings.of( 'npc-ada' ).dealt ).toEqual( [ { what: 'bribe-refused', atMin: 725 } ] );
		expect( app.economy.wallet.log.at( - 1 ) ).toEqual( { atMin: 725, what: 'bribe', amount: 0, npcId: 'npc-ada', name: 'Ada Vance' } );

	} );

	it.skipIf( ! words )( 'takes credits a typed line holds out only up to that sum, and notes a bribe an official refuses in words', async () => {

		const { app, conversation } = tradingApp();
		talkTo( app, conversation );
		const user = userEvent.setup();
		const textbox = () => within( app.view.dialog.element ).getByRole( 'textbox' );
		app.talk.stream.mockImplementationOnce( () => talkStream( [
			...replyEvents( 'That is kind. Thank you.' ).slice( 0, 2 ), { type: 'offer', kind: 'accept', amount: 25 }, { type: 'done', reply: 'That is kind. Thank you.' }
		] ) );
		await user.type( textbox(), 'Here\'s 10 credits for your trouble.{Enter}' );
		await vi.waitFor( () => expect( app.economy.wallet.credits ).toBe( 30 ) );
		expect( app.talk.stream.mock.calls.at( - 1 )[ 4 ].offers.credits ).toMatchObject( { purse: 40 } );

		document.body.replaceChildren();
		const official = tradingApp( { person: { job: { parcelId: 'p-police', role: 'security' } } } );
		talkTo( official.app, official.conversation );
		official.app.talk.stream.mockImplementationOnce( () => talkStream( replyEvents( 'No. I will note that you offered.' ) ) );
		await user.type( within( official.app.view.dialog.element ).getByRole( 'textbox' ), 'Here\'s 20 credits for your trouble.{Enter}' );
		await vi.waitFor( () => expect( official.app.regard.of( 'npc-ada' ) ).toBeTruthy() );
		expect( official.app.economy.wallet.credits ).toBe( 40 );
		expect( official.app.view.toast.element.textContent ).toContain( 'Ada Vance noted your offer.' );

	} );

	it( 'serves at a counter while the person works there and the player stands in it: buying pays the till and stacks the good', async () => {

		const { app, conversation } = tradingApp( { working: true, standing: { parcelId: 'p-bar' } } );
		talkTo( app, conversation );
		const menu = menuOf( 'restaurant', 'rich' );
		expect( names().filter( ( name ) => name.startsWith( 'Buy ' ) ) ).toEqual( menu.slice( 0, 3 ).map( ( good ) => `Buy ${good.name} · ${good.price} cr` ) );
		const user = userEvent.setup();
		const meal = menu.find( ( good ) => good.goodId === 'hot-meal' );
		expect( meal.price ).toBe( 14 );
		await user.click( row().getByRole( 'button', { name: 'Buy hot meal · 14 cr' } ) );
		expect( transcript( app ).slice( - 4 ) ).toEqual( [ 'Hot meal, please.', '14 cr. Here.', '−14 cr paid to Ada Vance', 'Hot meal' ] );
		expect( app.economy.wallet.credits ).toBe( 26 );
		expect( app.items.get( 'goods-hot-meal' ) ).toMatchObject( { kind: 'goods', label: 'Hot meal', quantity: 1, data: { price: 14, at: 'Wren\'s' } } );
		expect( toast( app, 'paid' ) ).toBe( '−14 cr paid to Ada Vance' );
		await user.click( row().getByRole( 'button', { name: 'Buy hot meal · 14 cr' } ) );
		expect( app.items.get( 'goods-hot-meal' ).quantity ).toBe( 2 );
		expect( app.economy.wallet.credits ).toBe( 12 );
		// Short of the price, nothing moves and the toast says what it costs.
		await user.click( row().getByRole( 'button', { name: 'Buy hot meal · 14 cr' } ) );
		expect( app.economy.wallet.credits ).toBe( 12 );
		expect( app.view.toast.element.textContent ).toContain( 'It costs 14 cr; you have 12 cr.' );

		// Away from the counter, or off duty, there is nothing to buy.
		app.standing = { parcelId: 'p1' };
		talkTo( app, conversation );
		expect( names().some( ( name ) => name.startsWith( 'Buy ' ) ) ).toBe( false );

	} );

	it( 'saves the wallet and what people carry through the save schema, and leaves the field out while the launcher cannot take it', async () => {

		const sent = [];
		const fetcher = vi.fn( async ( url, options ) => {

			const input = JSON.parse( options.body ).input;
			sent.push( input );
			const carried = Object.fromEntries( [ 'npcState', 'contacts', 'access', 'economy' ].filter( ( key ) => key in input ).map( ( key ) => [ key, input[ key ] ] ) );
			return { ok: true, status: 200, json: async () => ( {
				...gameFixture, player: input.player, quests: input.quests, sideJobs: input.sideJobs,
				currentLocation: input.currentLocation, discoveredLocations: input.discoveredLocations, ...carried,
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} ) };

		} );
		for ( const saves of [ true, false ] ) {

			const { app, conversation } = tradingApp( { gate: { saves, talk: saves } } );
			app.persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: gameFixture.id, fetcher } );
			app.body = { feet: { x: 1, y: 2, z: 3 } };
			app.controller = { yaw: 0.5 };
			app.locator = { location: () => ( { id: 'p1', name: 'Quay' } ) };
			app.discoveredLocations = new Map();
			app.quests = { ...app.quests, persistenceView: () => [] };
			app.sim.serialize = () => ( { version: '1', seed: 'fixture-seed', events: [] } );
			app.npcContinuity = { serialize: () => ( { version: '2', actors: [], follow: null, returns: [], conversation: null } ) };
			app.companion.serialize = () => ( { version: '1', npcId: 'npc-ada', kind: 'follow', startedAtMin: 700, phase: 'walking' } );
			app.transitGameplay = { state: { status: 'waiting', clock: { dayOffset: 0, lastDaySeconds: 43500 } } };
			app.questGameplay = { ...app.questGameplay, serializeTransit: () => null, serializeEscort: () => null };
			app.investigations = { serialize: () => [] };
			app.scenery = { serialize: () => [] };
			app.playStartedAt = performance.now();
			app.talk.memory = vi.fn( async () => [] );
			app.economy?.trades.pay( 'npc-ada', 7, 'for the way' );
			app.conversationShown = conversation;
			app.presentConversation( null );
			await vi.waitFor( () => expect( fetcher ).toHaveBeenCalledTimes( saves ? 1 : 2 ), { timeout: 4000 } );
			await app.persistence.pending;

		}
		expect( sent[ 0 ].economy ).toMatchObject( {
			credits: 33, paidWeek: 0, settled: [], log: [ { atMin: 725, what: 'paid', amount: - 7, npcId: 'npc-ada', name: 'Ada Vance' } ],
			people: [ { npcId: 'npc-ada', gone: [], got: [], dealt: [ { what: 'got-credits', amount: 7, atMin: 725 } ] } ]
		} );
		expect( 'economy' in sent[ 1 ] ).toBe( false );

	} );

} );
