import { describe, expect, it, vi } from 'vitest';
import gameFixture from '../../library/fixtures/out/games/night-shift/game.json';
import { GamePersistence, mergeInventory, mergeProgress, saveItemId } from './GamePersistence.js';
import { OPTIONAL_SAVE_FIELDS, carriedFields } from './SavedFields.js';
import { SchemaBoundary } from './SchemaBoundary.js';
import { AddressBook, PlayerAccess, PlayerItems, Regard, cardFor } from '../access/index.js';

const activeQuest = {
	...gameFixture.quests[ 0 ],
	objective: 'Talk to Mara',
	completedSteps: [ 'reach-roof', 'read-signal' ],
	runtime: {
		cast: { witness: 'npc-1' },
		state: { activeStepIds: [ 'talk-mara' ], completedStepIds: [ 'reach-roof', 'read-signal' ], flags: [] }
	}
};

const activeJourney = {
	status: 'aboard',
	clock: { dayOffset: 0, lastDaySeconds: 46805 },
	tripId: 'trip:8:route-b1:46800',
	routeId: 'route-b1',
	serviceDeparture: 46800,
	boardedStopIndex: 0
};

const questTransit = {
	questId: 'main', stepId: 'escape', stage: 'aboard',
	tripId: activeJourney.tripId, routeId: activeJourney.routeId, passengerNpcId: 'npc-1'
};

const npcState = {
	timeMin: 780,
	simulation: { version: '1', seed: 'fixture-seed', events: [] },
	continuity: { version: '2', actors: [], follow: null, returns: [], conversation: null },
	questEscort: { questId: 'main', stepId: 'escort-witness', npcId: 'npc-1', mode: 'lead-player' },
	companion: { version: '1', npcId: 'npc-2', kind: 'follow', startedAtMin: 770, phase: 'walking' }
};

const investigations = [ {
	contractVersion: '1.0', sceneId: 'scene-apartment-47', revision: 2,
	evidence: [ { evidenceId: 'access-card', status: 'collected' } ],
	emittedTransitionIds: [ 'record-card-owner' ]
} ];

const scenery = [
	{ contractVersion: '1.0', sceneId: 'courier-found', status: 'retired', stagedAtMin: 700, retiredAtMin: 760 },
	{
		contractVersion: '1.0', sceneId: 'roof-wake', status: 'staged', stagedAtMin: 775,
		resolved: { place: { parcelId: 'p3', floor: 1, roomId: 'f1-r2' }, actors: [ { actorId: 'mourner', gender: 'female', appearanceSeed: 91 } ] }
	}
];

const dialogueMemory = [ {
	npcId: 'npc-1',
	memory: { digest: [ 'The player asked about the roof.' ], turns: [ { speaker: 'player', text: 'Who was up there?', atMin: 779 } ] }
} ];

const liveState = ( elapsedSeconds = 12.5 ) => ( {
	position: { x: 20, y: 0.12, z: 5 },
	heading: - 0.75,
	inventory: [ { id: 'signal-note', name: 'Signal Note', quantity: 1, state: { kind: 'information' } } ],
	quests: [ activeQuest ],
	sideJobs: gameFixture.sideJobs,
	currentLocation: { id: 'p3', name: 'p3 cafe' },
	discoveredLocations: [ ...gameFixture.discoveredLocations ],
	transitJourney: activeJourney,
	questTransit,
	npcState,
	investigations,
	scenery,
	dialogueMemory,
	elapsedSeconds
} );

describe( 'playable game persistence', () => {

	it( 'posts a schema-valid save with position, progress, inventory, locations and cumulative play time', async () => {

		const requests = [];
		const fetcher = vi.fn( async function ( url, options ) {

			expect( this ).toBe( globalThis );
			const request = JSON.parse( options.body );
			requests.push( request );
			const input = request.input;
			return response( 200, {
				...gameFixture,
				player: input.player,
				quests: input.quests,
				sideJobs: input.sideJobs,
				currentLocation: input.currentLocation,
				discoveredLocations: input.discoveredLocations,
				transitJourney: input.transitJourney,
				questTransit: input.questTransit,
				npcState: input.npcState,
				investigations: input.investigations,
				scenery: input.scenery,
				dialogueMemory: input.dialogueMemory,
				save: {
					...gameFixture.save,
					revision: input.expectedRevision + 1,
					updatedAt: input.updatedAt,
					playTimeSeconds: input.playTimeSeconds
				}
			} );

		} );
		const persistence = new GamePersistence( {
			game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher,
			now: () => new Date( '2026-09-03T12:00:00Z' )
		} );

		const saved = await persistence.save( liveState() );
		expect( fetcher ).toHaveBeenCalledOnce();
		expect( requests[ 0 ] ).toMatchObject( {
			method: 'saveCurrent',
			input: {
				gameId: 'night-shift', expectedRevision: 1,
				updatedAt: '2026-09-03T12:00:00.000Z', playTimeSeconds: 1812.5,
				player: { position: { x: 20, y: 0.12, z: 5 }, heading: - 0.75 },
				quests: [ activeQuest ], currentLocation: { id: 'p3', name: 'p3 cafe' },
				transitJourney: activeJourney,
				questTransit,
				npcState,
				investigations,
				scenery,
				dialogueMemory
			}
		} );
		expect( requests[ 0 ].input.discoveredLocations ).toEqual( [
			{ id: 'p2', name: 'Market Two' }, { id: 'p3', name: 'p3 cafe' }
		] );
		expect( saved.save.revision ).toBe( 2 );
		expect( saved.transitJourney ).toEqual( activeJourney );
		expect( saved.questTransit ).toEqual( questTransit );
		expect( saved.npcState ).toEqual( npcState );
		expect( saved.investigations ).toEqual( investigations );
		expect( saved.scenery ).toEqual( scenery );
		expect( saved.dialogueMemory ).toEqual( dialogueMemory );

	} );

	it( 'loads a save made before scenery and dialogue memory, and carries saved ones a live state leaves out', async () => {

		const sent = [];
		const fetcher = vi.fn( async ( _url, options ) => {

			const input = JSON.parse( options.body ).input;
			sent.push( input );
			const { gameId, expectedRevision, updatedAt, playTimeSeconds, ...fields } = input;
			return response( 200, {
				...gameFixture, ...fields,
				save: { ...gameFixture.save, revision: expectedRevision + 1, updatedAt, playTimeSeconds }
			} );

		} );
		const { scenery: droppedScenery, dialogueMemory: droppedMemory, ...earlier } = liveState();
		expect( droppedScenery && droppedMemory ).toBeTruthy();
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		await persistence.save( earlier );
		expect( sent[ 0 ] ).not.toHaveProperty( 'scenery' );
		expect( sent[ 0 ] ).not.toHaveProperty( 'dialogueMemory' );

		const resumed = new GamePersistence( { game: { ...structuredClone( gameFixture ), scenery, dialogueMemory }, gameId: 'night-shift', fetcher } );
		await resumed.save( earlier );
		expect( sent[ 1 ] ).toMatchObject( { scenery, dialogueMemory } );
		await expect( resumed.save( { ...earlier, scenery: [ { contractVersion: '1.0', sceneId: 'roof-wake', status: 'staged' } ] } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );

	} );

	it( 'saves the economy and a story item handed to somebody, keeps the economy a save leaves out, and loads a save made before both', async () => {

		const economy = {
			credits: 22, paidWeek: 0, settled: [ 'shift:main/s_sort' ],
			people: [ { npcId: 'npc-1', credits: 7, gone: [ 'effect' ], got: [ { id: 'drink_whisky_kessel', name: 'amber whisky', kind: 'story', atMin: 770 } ] } ],
			log: [ { atMin: 760, what: 'bought', amount: - 18, name: 'Tomas Wren' } ]
		};
		const handed = { ...activeQuest, runtime: { ...activeQuest.runtime, state: { ...activeQuest.runtime.state, handed: [ { itemId: 'DRINK_WHISKY_KESSEL', npcId: 'npc-1' } ] } } };
		const sent = [];
		const fetcher = vi.fn( async ( _url, options ) => {

			const input = JSON.parse( options.body ).input;
			sent.push( input );
			const { gameId, expectedRevision, updatedAt, playTimeSeconds, ...fields } = input;
			return response( 200, { ...gameFixture, ...fields, save: { ...gameFixture.save, revision: expectedRevision + 1, updatedAt, playTimeSeconds } } );

		} );
		const boundary = new SchemaBoundary();
		expect( OPTIONAL_SAVE_FIELDS ).toContain( 'economy' );
		// A save made before credits loads as it is.
		expect( boundary.assert( 'game-state', structuredClone( gameFixture ), 'E_GAME_STATE', 'game' ) ).toBeTruthy();
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		const saved = await persistence.save( { ...liveState(), quests: [ handed ], economy } );
		expect( sent[ 0 ] ).toMatchObject( { economy, quests: [ { runtime: { state: { handed: [ { itemId: 'DRINK_WHISKY_KESSEL', npcId: 'npc-1' } ] } } } ] } );
		expect( boundary.assert( 'game-state', saved, 'E_GAME_STATE', 'game' ) ).toBe( saved );
		// A save that leaves it out carries the one saved before.
		await persistence.save( liveState() );
		expect( sent[ 1 ].economy ).toEqual( economy );
		expect( carriedFields( {}, { economy } ) ).toEqual( { economy } );
		expect( carriedFields( { economy: { ...economy, credits: 1 } }, { economy } ).economy.credits ).toBe( 1 );
		for ( const invalid of [
			{ ...economy, credits: - 1 }, { ...economy, people: [ { npcId: 'npc-1', credits: 1, gone: [] } ] }, { ...economy, log: [ { atMin: 1, what: 'gift', amount: 1 } ] }
		] ) await expect( persistence.save( { ...liveState(), economy: invalid } ) ).rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), quests: [ { ...handed, runtime: { ...handed.runtime, state: { ...handed.runtime.state, handed: [ { itemId: 'X' } ] } } } ] } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );

	} );

	it( 'serializes repeated saves onto the revision and play time returned by the previous save', async () => {

		const revisions = [];
		const fetcher = vi.fn( async ( _url, options ) => {

			const input = JSON.parse( options.body ).input;
			revisions.push( [ input.expectedRevision, input.playTimeSeconds ] );
			return response( 200, {
				...gameFixture,
				player: input.player, quests: input.quests, sideJobs: input.sideJobs,
				currentLocation: input.currentLocation, discoveredLocations: input.discoveredLocations,
				transitJourney: input.transitJourney,
				questTransit: input.questTransit,
				npcState: input.npcState,
				investigations: input.investigations,
				scenery: input.scenery,
				dialogueMemory: input.dialogueMemory,
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} );

		} );
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		await Promise.all( [ persistence.save( liveState( 10 ) ), persistence.save( liveState( 25 ) ) ] );

		expect( revisions ).toEqual( [ [ 1, 1810 ], [ 2, 1825 ] ] );

	} );

	it( 'calls a game unplayed until a save carries play time', () => {

		const fresh = structuredClone( gameFixture );
		fresh.save.playTimeSeconds = 0;

		expect( new GamePersistence( { game: fresh, gameId: 'night-shift', fetcher: vi.fn() } ).unplayed ).toBe( true );
		expect( new GamePersistence( { game: gameFixture, gameId: 'night-shift', fetcher: vi.fn() } ).unplayed ).toBe( false );

	} );

	it( 'rejects mismatched loaded games, invalid live values, and malformed save responses', async () => {

		expect( () => new GamePersistence( { game: gameFixture, gameId: 'other', fetcher: vi.fn() } ) )
			.toThrow( 'does not match requested game' );
		const persistence = new GamePersistence( {
			game: structuredClone( gameFixture ), gameId: 'night-shift',
			fetcher: vi.fn( async () => response( 200, { id: 'night-shift' } ) )
		} );
		await expect( persistence.save( { ...liveState(), heading: Number.NaN } ) ).rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), transitJourney: { status: 'aboard' } } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), questTransit: { ...questTransit, stage: 'approach' } } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), npcState: { ...npcState, continuity: { version: '1' } } } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), investigations: [ { sceneId: 'missing-state' } ] } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( liveState() ) ).rejects.toMatchObject( { code: 'E_SAVE_RESPONSE' } );

	} );

	it( 'saves a given card, a lifted card, the regard of a person who caught the theft and what people remember, and a reload brings them all back', async () => {

		const book = new AddressBook( { buildings: new Map(), nameOf: () => ( { name: 'Kessler Block' } ) } );
		const items = new PlayerItems();
		items.add( cardFor( 'home:p1724/floor:4/f1-unit-1', { book, issuer: { npcId: 'a43295', name: 'Drew Thorn' }, how: 'given', atMin: 1085.5 } ) );
		items.add( cardFor( 'homes:p1724', { book, issuer: { npcId: 'a26407', name: 'Pearl Vance' }, how: 'stolen', atMin: 1101 } ) );
		const regard = new Regard();
		regard.drop( 'a26407', 1101 );
		const memory = [ { npcId: 'a43295', memory: { digest: [], turns: [
			{ speaker: 'player', text: 'Can you give me access to your apartment?', atMin: 1085 },
			{ speaker: 'npc', text: 'Fine. Here is a card for apartment 401.', atMin: 1085 }
		] } }, { npcId: 'a50001', memory: {
			digest: [ 'Overheard, not said to you: you were there when the stranger talked to Drew Thorn, the resident. The stranger said: "Can you give me access?" Drew Thorn said: "Fine."' ],
			turns: [], heardAtMin: 1085
		} } ];
		// The server keeps what the save sends, as LauncherService.saveCurrent does.
		const fetcher = vi.fn( async ( url, options ) => {

			const input = JSON.parse( options.body ).input;
			return response( 200, {
				...gameFixture, player: input.player, quests: input.quests, sideJobs: input.sideJobs,
				currentLocation: input.currentLocation, discoveredLocations: input.discoveredLocations,
				...Object.fromEntries( [ 'npcState', 'dialogueMemory', 'contacts', 'access' ].filter( ( key ) => key in input ).map( ( key ) => [ key, input[ key ] ] ) ),
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} );

		} );
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		const live = {
			...liveState(), inventory: mergeInventory( [ ...liveState().inventory, ...items.serialize() ], [], [] ),
			dialogueMemory: memory, contacts: [ { npcId: 'a43295', addedMin: 1086 } ], access: { regard: regard.serialize() }
		};
		const saved = await persistence.save( live );

		// A reload: the saved descriptor loads through the same schemas, and the game takes its items and regard back.
		const reloaded = new GamePersistence( { game: JSON.parse( JSON.stringify( saved ) ), gameId: 'night-shift', fetcher } );
		const back = new PlayerItems();
		const questItems = back.restore( reloaded.game.player.inventory );
		expect( questItems ).toEqual( liveState().inventory );
		expect( back.list() ).toEqual( items.list() );
		expect( new PlayerAccess( { items: back, book } ).holds( 'home:p1724/floor:9/f1-unit-1' ) ).toBe( true );
		expect( new Regard().restore( reloaded.game.access.regard ).adjust( 'friendly', 'a26407' ) ).toBe( 'neutral' );
		expect( reloaded.game.dialogueMemory ).toEqual( memory );
		expect( reloaded.game.contacts ).toEqual( [ { npcId: 'a43295', addedMin: 1086 } ] );

		// An item the save cannot take names the field it failed on.
		await expect( persistence.save( { ...live, inventory: [ { ...live.inventory.at( - 1 ), id: 'card:home:p1724/floor:4/f1-unit-1' } ] } ) )
			.rejects.toThrow( /live game state does not match its schema: \/inventory\/0\/id must match pattern/ );

	} );

	it( 'keeps ordinary inventory, replaces quest-owned items, and retains uncast quest progress', () => {

		const savedItems = [
			{ id: 'car-key', name: 'Car Key', quantity: 1, state: {} },
			{ id: 'signal-note', name: 'Old Signal Note', quantity: 1, state: {} }
		];
		const liveItems = [ { id: 'signal-note', name: 'Signal Note', quantity: 2, state: { kind: 'information' } } ];
		expect( mergeInventory( savedItems, liveItems, [ 'signal-note', 'spent-pass' ] ) ).toEqual( [ savedItems[ 0 ], { ...liveItems[ 0 ], state: { kind: 'information', itemId: 'signal-note' } } ] );

		const progress = mergeProgress( gameFixture, [ activeQuest ] );
		expect( progress.quests ).toEqual( [ activeQuest ] );
		expect( progress.sideJobs ).toEqual( gameFixture.sideJobs );

	} );

} );

describe( 'quest item ids in the save', () => {

	it( 'lower-cases a story id into the save id and keeps every result within the save pattern', () => {

		expect( saveItemId( 'ACCESS_CARD_CLERK' ) ).toBe( 'access_card_clerk' );
		expect( saveItemId( 'DRINK_WHISKY_KESSEL' ) ).toBe( 'drink_whisky_kessel' );
		expect( saveItemId( 'signal-note' ) ).toBe( 'signal-note' );
		expect( saveItemId( 'Pen Drive #2' ) ).toBe( 'pen-drive-2' );
		expect( saveItemId( '__Hidden__' ) ).toBe( 'hidden' );
		expect( saveItemId( '***' ) ).toBe( 'q-item' );
		const long = `ITEM_${'X'.repeat( 90 )}`;
		expect( saveItemId( long ) ).toHaveLength( 64 );
		expect( saveItemId( long ) ).toBe( saveItemId( long ) );
		expect( saveItemId( long ) ).not.toBe( saveItemId( `${long}Y` ) );
		for ( const id of [ 'ACCESS_CARD_CLERK', 'Pen Drive #2', '__Hidden__', '***', long, 'a', '9-LIVES' ] ) {

			expect( saveItemId( id ) ).toMatch( /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/ );

		}

	} );

	it( 'saves a quest item by its save id with its story id in state, and takes a saved entry under either id as the quests\'', () => {

		const held = [ { id: 'ACCESS_CARD_CLERK', name: 'Clerk access card', quantity: 1, state: { kind: 'key', questlineIds: [ 'main' ] } } ];
		const saved = [
			{ id: 'access_card_clerk', name: 'Old copy', quantity: 1, state: { kind: 'key', itemId: 'ACCESS_CARD_CLERK' } },
			{ id: 'drink_whisky_kessel', name: 'Spent whisky', quantity: 1, state: { kind: 'substance', itemId: 'DRINK_WHISKY_KESSEL' } },
			{ id: 'car-key', name: 'Car Key', quantity: 1, state: {} }
		];
		expect( mergeInventory( saved, held, [ 'ACCESS_CARD_CLERK', 'DRINK_WHISKY_KESSEL' ] ) ).toEqual( [
			saved[ 2 ],
			{ id: 'access_card_clerk', name: 'Clerk access card', quantity: 1, state: { kind: 'key', questlineIds: [ 'main' ], itemId: 'ACCESS_CARD_CLERK' } }
		] );

	} );

	it( 'saves a live state holding a story\'s upper-case card through the real schemas', async () => {

		const fetcher = vi.fn( async ( url, options ) => {

			const input = JSON.parse( options.body ).input;
			return response( 200, {
				...gameFixture, player: input.player, quests: input.quests, sideJobs: input.sideJobs,
				currentLocation: input.currentLocation, discoveredLocations: input.discoveredLocations,
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} );

		} );
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		const held = [ { id: 'ACCESS_CARD_CLERK', name: 'Clerk access card', quantity: 1, state: { kind: 'key', questlineIds: [ 'main' ] } } ];
		const inventory = mergeInventory( [], held, [ 'ACCESS_CARD_CLERK' ] );
		const saved = await persistence.save( { ...liveState(), inventory } );
		expect( saved.player.inventory ).toEqual( [ expect.objectContaining( { id: 'access_card_clerk', state: expect.objectContaining( { itemId: 'ACCESS_CARD_CLERK' } ) } ) ] );
		// The story's own id, as the runtime holds it, is what the schema would refuse.
		await expect( persistence.save( { ...liveState(), inventory: held } ) ).rejects.toThrow( /\/inventory\/0\/id must match pattern/ );

	} );

} );

function response( status, body ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	};

}
