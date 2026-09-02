import { describe, expect, it } from 'vitest';
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

} );
