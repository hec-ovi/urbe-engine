import { describe, expect, it, vi } from 'vitest';
import { QuestSession } from './QuestSession.js';

const npc = {
	npcId: 'n1', type: 'barista', name: { given: 'Mara', family: 'Voss' },
	home: { parcelId: 'p2', unit: 1 }, family: [], routine: [], flags: { dead: false }
};

/** The slice of the simulation the runtime and the cast read, with one barista on duty at p1. */
const sim = {
	getNPC: ( id ) => { if ( id !== 'n1' ) throw new Error( 'E_UNKNOWN_ID' ); return npc; },
	findNPCs: () => [ npc ],
	getNPCVendor: () => npc,
	reserveNPC: () => npc,
	behaviorAt: () => ( { mode: 'interior', activity: 'working', place: { kind: 'parcel', id: 'p1' }, interrupted: false } ),
	applyFlag: () => {}, interrupt: () => {}, resume: () => {}
};

const definition = {
	id: 'q1', title: 'Static', premise: 'Somebody at the cafe wants a word.',
	roles: [ { roleId: 'barista', npcType: 'barista', persona: 'Tired.' } ],
	items: [], facts: [],
	acts: [ { actId: 'a1', title: 'The Word', summary: 'Go and listen.' } ],
	steps: [ {
		stepId: 's_talk', actId: 'a1',
		narrative: { description: 'The barista talks.', playerHint: 'Talk to the barista at the cafe.', stake: 'Or she carries it alone.' },
		wantedByRoleId: 'barista',
		target: { kind: 'talk', roleId: 'barista', atParcelId: 'p1' },
		gives: [], needs: [], conditions: [], effects: [], next: [], branching: 'parallel', endingId: 'e_done'
	} ],
	endings: [ { endingId: 'e_done', title: 'Heard', epilogue: 'She said it.' } ],
	flags: [], entryStepIds: [ 's_talk' ]
};

const continuedDefinition = {
	id: 'q1', title: 'Static', premise: 'Somebody at the cafe wants a word.',
	roles: [ { roleId: 'barista', npcType: 'barista', persona: 'Tired.' } ],
	items: [ { itemId: 'clue', name: 'Recorded clue', description: 'What Mara said.', kind: 'information' } ], facts: [],
	acts: [ { actId: 'a1', title: 'The Word', summary: 'Listen, then return.' } ],
	steps: [
		{
			stepId: 's_talk', actId: 'a1',
			narrative: { description: 'The barista talks.', playerHint: 'Talk to the barista at the cafe.', stake: 'Or she carries it alone.' },
			wantedByRoleId: 'barista',
			target: { kind: 'talk', roleId: 'barista', atParcelId: 'p1' },
			gives: [ 'clue' ], needs: [], conditions: [], effects: [],
			next: [ { toStepId: 's_return', when: [] } ], branching: 'parallel'
		},
		{
			stepId: 's_return', actId: 'a1',
			narrative: { description: 'The barista waits.', playerHint: 'Return to the barista.', stake: 'The clue stays unresolved.' },
			wantedByRoleId: 'barista',
			target: { kind: 'talk', roleId: 'barista', atParcelId: 'p1' },
			gives: [], needs: [ 'clue' ], conditions: [], effects: [], next: [], branching: 'parallel', endingId: 'e_done'
		}
	],
	endings: [ { endingId: 'e_done', title: 'Heard', epilogue: 'She said it.' } ],
	flags: [], entryStepIds: [ 's_talk' ]
};

describe( 'QuestSession', () => {

	it( 'casts the roles here, lists the open step with its person, and reports what a talk completes', () => {

		const session = QuestSession.create( [ definition ], sim, 600 );

		expect( session.view() ).toEqual( [ {
			id: 'q1', title: 'Static', text: 'Somebody at the cafe wants a word.', state: 'active',
			steps: [ { text: 'Talk to the barista at the cafe. (Mara Voss)', done: false } ]
		} ] );

		expect( session.advance( { kind: 'arrivedAt', parcelId: 'p9' }, 600 ) ).toEqual( [] );
		expect( session.snapshot() ).toEqual( [ { id: 'q1', cast: { barista: 'n1' }, state: { activeStepIds: [ 's_talk' ], completedStepIds: [], flags: [] } } ] );

		const moved = session.advance( { kind: 'talkedTo', npcId: 'n1' }, 601 );
		expect( moved ).toHaveLength( 1 );
		expect( moved[ 0 ].completed.map( ( s ) => s.stepId ) ).toEqual( [ 's_talk' ] );
		expect( moved[ 0 ].ending.title ).toBe( 'Heard' );
		expect( session.view()[ 0 ] ).toMatchObject( { state: 'done', text: 'She said it.', steps: [ { done: true } ] } );

	} );

	it( 'leaves out a questline nobody in the city can play', () => {

		const nobody = { ...sim, findNPCs: () => [], getNPCVendor: () => { throw new Error( 'E_NO_MATCH' ); } };
		expect( QuestSession.create( [ definition ], nobody, 600 ).empty ).toBe( true );

	} );

	it( 'round-trips active and completed progress through the game descriptor shape', () => {

		const session = QuestSession.create( [ continuedDefinition ], sim, 600 );
		session.advance( { kind: 'talkedTo', npcId: 'n1' }, 601 );

		const active = session.persistenceView();
		expect( active ).toEqual( [ {
			id: 'q1', title: 'Static', objective: 'Return to the barista. (Mara Voss)', state: 'active',
			totalSteps: 2, completedSteps: [ 's_talk' ],
			runtime: {
				cast: { barista: 'n1' },
				state: { activeStepIds: [ 's_return' ], completedStepIds: [ 's_talk' ], flags: [] }
			}
		} ] );

		const restored = QuestSession.create( [ continuedDefinition ], sim, 602, active );
		expect( restored.snapshot() ).toEqual( session.snapshot() );
		restored.advance( { kind: 'talkedTo', npcId: 'n1' }, 603 );

		const completed = restored.persistenceView();
		expect( completed[ 0 ] ).toMatchObject( {
			objective: 'She said it.', state: 'completed', completedSteps: [ 's_talk', 's_return' ],
			runtime: { state: { activeStepIds: [], completedStepIds: [ 's_talk', 's_return' ], flags: [], endingId: 'e_done' } }
		} );
		expect( QuestSession.create( [ continuedDefinition ], sim, 604, completed ).persistenceView() ).toEqual( completed );

	} );

	it( 'falls back to a fresh quest per stale entry without discarding valid saved quests', () => {

		const second = { ...definition, id: 'q2', title: 'Second' };
		const persisted = [
			{
				id: 'q1', title: 'Static', objective: 'Old step', state: 'active', totalSteps: 1, completedSteps: [],
				runtime: { cast: { barista: 'n1' }, state: { activeStepIds: [ 'removed_step' ], completedStepIds: [], flags: [] } }
			},
			{
				id: 'q2', title: 'Second', objective: 'She said it.', state: 'completed', totalSteps: 1, completedSteps: [ 's_talk' ],
				runtime: {
					cast: { barista: 'n1' },
					state: { activeStepIds: [], completedStepIds: [ 's_talk' ], flags: [], endingId: 'e_done' }
				}
			}
		];
		const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		const restored = QuestSession.create( [ definition, second ], sim, 600, persisted );

		expect( restored.persistenceView().map( ( quest ) => ( { id: quest.id, state: quest.state, completed: quest.completedSteps } ) ) ).toEqual( [
			{ id: 'q1', state: 'active', completed: [] },
			{ id: 'q2', state: 'completed', completed: [ 's_talk' ] }
		] );
		expect( warning ).toHaveBeenCalledOnce();
		expect( warning ).toHaveBeenCalledWith( expect.stringContaining( 'questline q1 restore ignored' ) );
		warning.mockRestore();

	} );

	it( 'restores legacy snapshots and merges held quest items for persistence', () => {

		const second = { ...continuedDefinition, id: 'q2', title: 'Second' };
		const session = QuestSession.create( [ continuedDefinition, second ], sim, 600 );
		session.advance( { kind: 'talkedTo', npcId: 'n1' }, 601 );

		expect( session.inventoryView() ).toEqual( [ {
			id: 'clue', name: 'Recorded clue', quantity: 2,
			state: { kind: 'information', description: 'What Mara said.', questlineIds: [ 'q1', 'q2' ] }
		} ] );
		expect( QuestSession.create( [ continuedDefinition, second ], sim, 602, session.snapshot() ).snapshot() ).toEqual( session.snapshot() );

	} );

} );
