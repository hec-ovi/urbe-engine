import { describe, expect, it } from 'vitest';
import { QuestMechanics } from './QuestMechanics.js';
import { QuestSession } from './QuestSession.js';
import { QuestActionError } from './QuestActionError.js';
import { npc, quest, role, simulation, step } from './quest.test-fixtures.js';

const TIME = 2040;

describe( 'selected quest mechanic completion', () => {

	it( 'rejects a wrong adapter, wrong authored identity, malformed proof, or completed target without mutation', () => {

		const { mechanics, session } = setup();
		const before = session.snapshot();
		const wrongAdapter = mechanics.complete( {
			questId: 'q_mechanics', stepId: 'hack', timeMin: TIME,
			event: { kind: 'sabotaged', targetId: 'terminal.service', place: { parcelId: 'p4' } }
		} );
		expect( wrongAdapter ).toMatchObject( { ok: false, code: 'wrong_event', progressed: false } );
		const wrongIdentity = mechanics.complete( {
			questId: 'q_mechanics', stepId: 'hack', timeMin: TIME,
			event: { kind: 'hacked', targetId: 'other', place: { parcelId: 'p4' } }
		} );
		expect( wrongIdentity ).toMatchObject( { ok: false, code: 'runtime_rejected', progressed: false } );
		expect( session.snapshot() ).toEqual( before );
		expect( () => mechanics.complete( {
			questId: 'q_mechanics', stepId: 'hack', timeMin: TIME,
			event: { kind: 'hacked', targetId: 'terminal.service', place: { parcelId: 'p4' }, inferred: true }
		} ) ).toThrowError( QuestActionError );

		const accepted = mechanics.complete( {
			questId: 'q_mechanics', stepId: 'hack', timeMin: TIME,
			event: { kind: 'hacked', targetId: 'terminal.service', place: { parcelId: 'p4' } }
		} );
		expect( accepted.ok ).toBe( true );
		expect( mechanics.complete( {
			questId: 'q_mechanics', stepId: 'hack', timeMin: TIME,
			event: { kind: 'hacked', targetId: 'terminal.service', place: { parcelId: 'p4' } }
		} ) ).toMatchObject( { ok: false, code: 'unknown_target' } );

	} );

} );

function setup() {

	const people = new Map( [ [ 'npc.witness', npc( 'npc.witness', 'witness', 'p4' ) ] ] );
	const session = QuestSession.create( [ mechanicsDefinition() ], simulation( people ), TIME );
	return { mechanics: new QuestMechanics( session ), session };

}

function mechanicsDefinition() {

	return quest( 'q_mechanics', {
		roles: [ role( 'witness', 'witness' ) ], flags: [ 'terminal_hacked' ],
		steps: [ step( 'hack', {
			kind: 'hacking', targetId: 'terminal.service', place: { parcelId: 'p4' }, completionFlag: 'terminal_hacked'
		}, { wantedByRoleId: 'witness', endingId: 'done' } ) ]
	} );

}
