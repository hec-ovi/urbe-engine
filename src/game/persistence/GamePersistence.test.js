import { describe, expect, it, vi } from 'vitest';
import gameFixture from '../../library/fixtures/out/games/night-shift/game.json';
import { GamePersistence, mergeInventory, mergeProgress } from './GamePersistence.js';

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

const npcState = {
	timeMin: 780,
	simulation: { version: '1', seed: 'fixture-seed', events: [] },
	continuity: { version: '1', actors: [], follow: null, conversation: null }
};

const investigations = [ {
	contractVersion: '1.0', sceneId: 'scene-apartment-47', revision: 2,
	evidence: [ { evidenceId: 'access-card', status: 'collected' } ],
	emittedTransitionIds: [ 'record-card-owner' ]
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
	npcState,
	investigations,
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
				npcState: input.npcState,
				investigations: input.investigations,
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
				npcState,
				investigations
			}
		} );
		expect( requests[ 0 ].input.discoveredLocations ).toEqual( [
			{ id: 'p2', name: 'Market Two' }, { id: 'p3', name: 'p3 cafe' }
		] );
		expect( saved.save.revision ).toBe( 2 );
		expect( saved.transitJourney ).toEqual( activeJourney );
		expect( saved.npcState ).toEqual( npcState );
		expect( saved.investigations ).toEqual( investigations );

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
				npcState: input.npcState,
				investigations: input.investigations,
				save: { ...gameFixture.save, revision: input.expectedRevision + 1, updatedAt: input.updatedAt, playTimeSeconds: input.playTimeSeconds }
			} );

		} );
		const persistence = new GamePersistence( { game: structuredClone( gameFixture ), gameId: 'night-shift', fetcher } );
		await Promise.all( [ persistence.save( liveState( 10 ) ), persistence.save( liveState( 25 ) ) ] );

		expect( revisions ).toEqual( [ [ 1, 1810 ], [ 2, 1825 ] ] );

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
		await expect( persistence.save( { ...liveState(), npcState: { ...npcState, continuity: { version: '1' } } } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( { ...liveState(), investigations: [ { sceneId: 'missing-state' } ] } ) )
			.rejects.toMatchObject( { code: 'E_LIVE_STATE' } );
		await expect( persistence.save( liveState() ) ).rejects.toMatchObject( { code: 'E_SAVE_RESPONSE' } );

	} );

	it( 'keeps ordinary inventory, replaces quest-owned items, and retains uncast quest progress', () => {

		const savedItems = [
			{ id: 'car-key', name: 'Car Key', quantity: 1, state: {} },
			{ id: 'signal-note', name: 'Old Signal Note', quantity: 1, state: {} }
		];
		const liveItems = [ { id: 'signal-note', name: 'Signal Note', quantity: 2, state: { kind: 'information' } } ];
		expect( mergeInventory( savedItems, liveItems, [ 'signal-note', 'spent-pass' ] ) ).toEqual( [ savedItems[ 0 ], liveItems[ 0 ] ] );

		const progress = mergeProgress( gameFixture, [ activeQuest ] );
		expect( progress.quests ).toEqual( [ activeQuest ] );
		expect( progress.sideJobs ).toEqual( gameFixture.sideJobs );

	} );

} );

function response( status, body ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body
	};

}
