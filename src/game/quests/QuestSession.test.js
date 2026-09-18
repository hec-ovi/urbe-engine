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

} );

function sim() {

	return simulation( new Map( [ [ 'n1', npc( 'n1', 'barista', 'p1' ) ] ] ) );

}
