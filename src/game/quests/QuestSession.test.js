import { describe, expect, it, vi } from 'vitest';
import { QuestSession } from './QuestSession.js';
import { npc, quest, role, simulation, step } from './quest.test-fixtures.js';

const talk = { kind: 'talk', roleId: 'barista', atParcelId: 'p1' };
const definition = quest( 'q1', {
	roles: [ role( 'barista', 'barista' ) ],
	items: [ { itemId: 'clue', name: 'Recorded clue', description: 'What Mara said.', kind: 'information' } ],
	steps: [
		step( 's_talk', talk, { gives: [ 'clue' ], hint: 'Talk to the barista at the cafe.', next: [ { toStepId: 's_return', when: [] } ] } ),
		step( 's_return', talk, { needs: [ 'clue' ], hint: 'Return to the barista.', endingId: 'done' } )
	]
} );

describe( 'QuestSession', () => {

	it( 'round-trips active and completed progress through the game descriptor shape', () => {

		const session = QuestSession.create( [ definition ], sim(), 600 );
		session.advance( { kind: 'talkedTo', npcId: 'n1' }, 601 );

		const active = session.persistenceView();
		expect( active ).toEqual( [ {
			id: 'q1', title: 'q1', objective: 'Return to the barista. (barista Vale)', state: 'active',
			totalSteps: 2, completedSteps: [ 's_talk' ],
			runtime: { cast: { barista: 'n1' }, state: { activeStepIds: [ 's_return' ], completedStepIds: [ 's_talk' ], flags: [] } }
		} ] );

		const restored = QuestSession.create( [ definition ], sim(), 602, active );
		expect( restored.snapshot() ).toEqual( session.snapshot() );
		restored.advance( { kind: 'talkedTo', npcId: 'n1' }, 603 );

		const completed = restored.persistenceView();
		expect( completed[ 0 ] ).toMatchObject( {
			objective: 'q1 complete.', state: 'completed', completedSteps: [ 's_talk', 's_return' ],
			runtime: { state: { activeStepIds: [], completedStepIds: [ 's_talk', 's_return' ], flags: [], endingId: 'done' } }
		} );
		expect( QuestSession.create( [ definition ], sim(), 604, completed ).persistenceView() ).toEqual( completed );

	} );

	it( 'projects each step once for the HUD and the log, and keeps an untouched side job on offer', () => {

		const window = { label: 'during the slow hour', days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 1080, endMin: 1380 };
		const side = quest( 'q2', {
			roles: [ role( 'barista', 'barista' ) ],
			steps: [ step( 's_open', { ...talk, atParcelId: 'p1' }, { hint: 'Meet the barista during the slow hour.', endingId: 'done' } ) ]
		} );
		side.steps[ 0 ].window = window;
		const session = QuestSession.create( [ definition, side ], sim(), 600 );

		const [ main, sideJob ] = session.view( 600 );
		expect( main.state ).toBe( 'active' );
		expect( main.steps ).toEqual( [ {
			stepId: 's_talk', text: 'Talk to the barista at the cafe.', done: false, npcName: 'barista Vale',
			place: { kind: 'parcel', id: 'p1', name: null }, availability: { available: true }, window: null
		} ] );

		// A side job nobody has started is on offer, and says when it opens.
		expect( sideJob.state ).toBe( 'available' );
		expect( sideJob.steps[ 0 ] ).toMatchObject( {
			text: 'Meet the barista during the slow hour.', npcName: 'barista Vale', window,
			availability: { available: false, reason: 'outside_window', text: 'This objective is open at another hour. Open 18:00 to 23:00.' }
		} );
		expect( session.persistenceView( 600 ).map( ( entry ) => entry.state ) ).toEqual( [ 'active', 'available' ] );

		// One step done and the side job is under way, saved and reloaded.
		session.advanceFor( 'q2', { kind: 'talkedTo', npcId: 'n1' }, 1200 );
		const progress = session.persistenceView( 1200 );
		expect( progress[ 1 ] ).toMatchObject( { state: 'completed' } );
		expect( QuestSession.create( [ definition, side ], sim(), 1200, progress ).view( 1200 )[ 1 ].state ).toBe( 'done' );

		expect( session.holdsCast( 'n1' ) ).toBe( true );
		expect( session.holdsCast( 'n9' ) ).toBe( false );

	} );

	it( 'keeps a questline the cast could not fill in the log, with what stopped it', () => {

		const uncastable = quest( 'q_blocked', {
			roles: [ role( 'fixer', 'fixer' ) ],
			steps: [ step( 's_meet', { kind: 'talk', roleId: 'fixer', atParcelId: 'p1' }, { hint: 'Find the fixer.', endingId: 'done' } ) ]
		} );
		const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const session = QuestSession.create( [ definition, uncastable ], sim(), 600 );
		const reported = warning.mock.calls.at( - 1 )[ 0 ];
		warning.mockRestore();

		expect( reported ).toContain( 'questline q_blocked not cast' );
		expect( session.entries.map( ( entry ) => entry.definition.id ) ).toEqual( [ 'q1' ] );
		const [ , blocked ] = session.view( 600 );
		expect( blocked ).toMatchObject( { id: 'q_blocked', title: 'q_blocked', state: 'blocked', steps: [] } );
		expect( reported ).toContain( blocked.note );

	} );

	it( 'keeps a restored shared character when a new side job is added', () => {

		const people = simulation( new Map( [ [ 'n1', npc( 'n1', 'barista', 'p1' ) ], [ 'n2', npc( 'n2', 'barista', 'p1' ) ] ] ) );
		const saved = QuestSession.create( [ definition ], people, 600 ).snapshot();
		const side = { ...structuredClone( definition ), id: 'q_side', title: 'Side job' };
		const restored = QuestSession.create( [ definition, side ], people, 600, saved );

		expect( restored.entries.map( ( { runtime } ) => runtime.cast.barista ) ).toEqual( [ 'n1', 'n1' ] );
		expect( restored.blocked ).toEqual( [] );
		const savedSide = QuestSession.create( [ side ], people, 600 ).snapshot();
		expect( QuestSession.create( [ definition, side ], people, 600, savedSide ).entries
			.map( ( { runtime } ) => runtime.cast.barista ) ).toEqual( [ 'n1', 'n1' ] );

	} );

	it( 'repairs a legacy save that gave two characters one body without losing completed steps', () => {

		const def = quest( 'legacy', {
			roles: [ role( 'a', 'barista' ), role( 'b', 'barista' ) ],
			steps: [
				step( 'first', { ...talk, roleId: 'a' }, { next: [ { toStepId: 'second', when: [] } ] } ),
				step( 'second', { ...talk, roleId: 'b' }, { endingId: 'done' } )
			]
		} );
		const people = simulation( new Map( [ [ 'n1', npc( 'n1', 'barista', 'p1' ) ], [ 'n2', npc( 'n2', 'barista', 'p1' ) ] ] ) );
		const state = { activeStepIds: [ 'second' ], completedStepIds: [ 'first' ], flags: [] };
		const restored = QuestSession.create( [ def ], people, 600, [ { id: def.id, cast: { a: 'n1', b: 'n1' }, state } ] );

		expect( restored.entries[ 0 ].runtime.cast ).toEqual( { a: 'n1', b: 'n2' } );
		expect( restored.entries[ 0 ].runtime.serialize() ).toEqual( state );
		expect( restored.advanceFor( def.id, { kind: 'talkedTo', npcId: 'n2' }, 600 ) ).toHaveLength( 1 );

	} );

	it( 'stamps a carried questline\'s places from the world and casts one person per character across the set', () => {

		const carried = ( id, roleId ) => {

			const definition = quest( id, {
				roles: [ role( roleId, 'barista' ) ],
				steps: [ step( 's_go', { kind: 'goto', place: { parcelId: 'p1' } }, { hint: 'Go to the cafe.', endingId: 'done', wantedByRoleId: roleId } ) ]
			} );
			delete definition.steps[ 0 ].target.place.name;
			return definition;

		};
		const world = { meta: { seed: 's' }, districts: [ { id: 'd0', name: 'Old Town' } ], parcels: [ { id: 'p1', districtId: 'd0', type: 'coffee_shop', tier: 'mid' } ] };
		const types = {
			meta: { theme: 't', worldSeed: 's', createdAt: 'now' }, namePool: { given: [], family: [] },
			types: [ { type: 'barista', label: 'Barista', category: 'vendor', boilerplate: 'Pulls shots.', grounding: {}, weight: 1 } ]
		};
		const people = simulation( new Map( [ [ 'n1', npc( 'n1', 'barista', 'p1' ) ], [ 'n2', npc( 'n2', 'barista', 'p1' ) ] ] ) );
		const session = QuestSession.create( [ carried( 'q1', 'first' ), carried( 'q2', 'second' ) ], people, 600, [], { world, types } );

		expect( session.entries.map( ( { definition } ) => definition.steps[ 0 ].target.place ) ).toEqual( [ { parcelId: 'p1', name: 'coffee shop' }, { parcelId: 'p1', name: 'coffee shop' } ] );
		expect( session.entries.map( ( { runtime } ) => Object.values( runtime.cast )[ 0 ] ) ).toEqual( [ 'n1', 'n2' ] );

	} );

} );

function sim() {

	return simulation( new Map( [ [ 'n1', npc( 'n1', 'barista', 'p1' ) ] ] ) );

}
