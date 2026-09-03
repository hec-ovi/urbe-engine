import { describe, expect, it } from 'vitest';
import { QuestMechanics } from './QuestMechanics.js';
import { QuestSession } from './QuestSession.js';
import { QuestActionError } from './QuestActionError.js';

const TIME = 2040;

describe( 'selected quest mechanic completion', () => {

	it( 'adapts all seven measured host events through the real quests runtime', () => {

		const { mechanics, session, people } = setup();
		const witnessId = cast( session, 'q_mechanics', 'witness' );
		const markId = cast( session, 'q_assassinate', 'mark' );
		const sequence = [
			[ 'hack', { kind: 'hacked', targetId: 'terminal.service', place: { parcelId: 'p4' } } ],
			[ 'access', { kind: 'accessed', accessPointId: 'door.service', credentialItemId: 'entry.code', place: { parcelId: 'p4' } } ],
			[ 'rescue', { kind: 'released', npcId: witnessId, releaseTargetId: 'restraint.witness', place: { parcelId: 'p4' } } ],
			[ 'escort', { kind: 'escorted', npcId: witnessId, routeId: 'route.safe', mode: 'follow-player', from: { parcelId: 'p4' }, to: { parcelId: 'p7' } } ],
			[ 'transport', { kind: 'transported', journeyId: 'journey.tower', mode: 'public-transit', from: { parcelId: 'p7' }, to: { stationId: 'central' }, passengerNpcIds: [], cargoItemIds: [] } ],
			[ 'sabotage', { kind: 'sabotaged', targetId: 'relay.primary', place: { stationId: 'central' } } ]
		];

		for ( const [ stepId, event ] of sequence ) {

			const result = mechanics.complete( { questId: 'q_mechanics', stepId, timeMin: TIME, event } );
			expect( result ).toMatchObject( {
				ok: true, questId: 'q_mechanics', stepId, eventKind: event.kind, progressed: true,
				completed: [ { questId: 'q_mechanics', stepIds: [ stepId ] } ]
			} );

		}
		const killed = mechanics.complete( {
			questId: 'q_assassinate', stepId: 'assassinate', timeMin: TIME,
			event: { kind: 'killed', npcId: markId }
		} );
		expect( killed ).toMatchObject( {
			ok: true, eventKind: 'killed', completed: [ { questId: 'q_assassinate', stepIds: [ 'assassinate' ], endingId: 'done' } ]
		} );
		expect( people.get( markId ).flags.dead ).toBe( true );

	} );

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

	const people = new Map( [
		[ 'npc.witness', npc( 'npc.witness', 'witness', 'p4' ) ],
		[ 'npc.mark', npc( 'npc.mark', 'mark', 'p1' ) ]
	] );
	const sim = {
		getNPC: ( npcId ) => people.get( npcId ) ?? fail( `unknown ${npcId}` ),
		findNPCs: ( query ) => [ ...people.values() ].filter( ( person ) => person.type === query.type ),
		getNPCVendor: ( query ) => [ ...people.values() ].find( ( person ) => person.type === ( query.npcType ?? query.type ) ) ?? null,
		reserveNPC: ( query ) => [ ...people.values() ].find( ( person ) => person.type === ( query.npcType ?? query.type ) ) ?? null,
		behaviorAt: ( npcId ) => ( { mode: 'interior', activity: 'working', place: { kind: 'parcel', id: people.get( npcId ).job.parcelId }, interrupted: false } ),
		applyFlag: ( npcId, operation ) => { if ( operation.kind === 'die' ) people.get( npcId ).flags.dead = true; },
		interrupt() {}, resume() {}
	};
	const session = QuestSession.create( [ mechanicsDefinition(), assassinateDefinition() ], sim, TIME );
	return { mechanics: new QuestMechanics( session ), session, people };

}

function mechanicsDefinition() {

	const flags = [ 'terminal_hacked', 'door_open', 'witness_released', 'witness_safe', 'ride_complete', 'relay_disabled' ];
	const targets = [
		[ 'hack', { kind: 'hacking', targetId: 'terminal.service', place: { parcelId: 'p4' }, completionFlag: flags[ 0 ] } ],
		[ 'access', { kind: 'access', accessPointId: 'door.service', credentialItemId: 'entry.code', place: { parcelId: 'p4' }, completionFlag: flags[ 1 ] } ],
		[ 'rescue', { kind: 'rescue', roleId: 'witness', releaseTargetId: 'restraint.witness', place: { parcelId: 'p4' }, completionFlag: flags[ 2 ] } ],
		[ 'escort', { kind: 'escort', roleId: 'witness', routeId: 'route.safe', mode: 'follow-player', from: { parcelId: 'p4' }, to: { parcelId: 'p7' }, completionFlag: flags[ 3 ] } ],
		[ 'transport', { kind: 'transportation', journeyId: 'journey.tower', mode: 'public-transit', from: { parcelId: 'p7' }, to: { stationId: 'central' }, passengerRoleIds: [], cargoItemIds: [], completionFlag: flags[ 4 ] } ],
		[ 'sabotage', { kind: 'sabotage', targetId: 'relay.primary', place: { stationId: 'central' }, completionFlag: flags[ 5 ] } ]
	];
	return {
		id: 'q_mechanics', title: 'Measured mechanics', premise: 'Complete measured objectives.',
		roles: [ role( 'witness', 'witness' ) ],
		items: [ { itemId: 'entry.code', name: 'Entry code', description: 'A recovered service code.', kind: 'information' } ],
		facts: [], acts: [ { actId: 'act', title: 'Actions', summary: 'Complete every measured action.' } ],
		steps: targets.map( ( [ stepId, target ], index ) => step( stepId, target, {
			gives: stepId === 'hack' ? [ 'entry.code' ] : [],
			needs: stepId === 'access' ? [ 'entry.code' ] : [],
			effects: [ { kind: 'setFlag', flag: flags[ index ] } ],
			next: index < targets.length - 1 ? [ { toStepId: targets[ index + 1 ][ 0 ], when: [] } ] : [],
			...( index === targets.length - 1 ? { endingId: 'done' } : {} )
		} ) ),
		endings: [ { endingId: 'done', title: 'Complete', epilogue: 'Every measured action completed.' } ],
		flags, entryStepIds: [ 'hack' ]
	};

}

function assassinateDefinition() {

	return {
		id: 'q_assassinate', title: 'Target', premise: 'Stop the marked person.',
		roles: [ role( 'mark', 'mark' ) ], items: [], facts: [],
		acts: [ { actId: 'act', title: 'Target', summary: 'Stop the target.' } ],
		steps: [ step( 'assassinate', { kind: 'assassinate', roleId: 'mark' }, { endingId: 'done' } ) ],
		endings: [ { endingId: 'done', title: 'Stopped', epilogue: 'The target is down.' } ],
		flags: [], entryStepIds: [ 'assassinate' ]
	};

}

function step( stepId, target, options = {} ) {

	return {
		stepId, actId: 'act',
		narrative: {
			description: `${stepId} completed.`, playerHint: `Complete ${stepId}.`, stake: `${stepId} remains open.`
		},
		wantedByRoleId: target.roleId ?? 'witness', target,
		gives: options.gives ?? [], needs: options.needs ?? [], conditions: [], effects: options.effects ?? [],
		next: options.next ?? [], branching: 'parallel', ...( options.endingId ? { endingId: options.endingId } : {} )
	};

}

function role( roleId, npcType ) {

	return { roleId, npcType, persona: `${roleId} follows exact authored identities.` };

}

function npc( npcId, type, parcelId ) {

	return {
		npcId, type, name: { given: type, family: 'Vale' }, home: { parcelId, unit: 1 }, family: [],
		job: { parcelId, role: type }, routine: [ {
			days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 0, endMin: 1440,
			activity: 'working', place: { kind: 'parcel', id: parcelId }
		} ], flags: { dead: false }
	};

}

function cast( session, questId, roleId ) {

	return session.entries.find( ( entry ) => entry.definition.id === questId ).runtime.cast[ roleId ];

}

function fail( message ) {

	throw new Error( message );

}
