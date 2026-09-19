import { describe, expect, it } from 'vitest';
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
