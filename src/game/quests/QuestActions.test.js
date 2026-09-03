import { describe, expect, it, vi } from 'vitest';
import { QuestActionError } from './QuestActionError.js';
import { QuestActions } from './QuestActions.js';
import { QuestSession } from './QuestSession.js';

const people = {
	n_listener_a: npc( 'n_listener_a', 'listener_a', 'Aya', 'p_listen' ),
	n_listener_b: npc( 'n_listener_b', 'listener_b', 'Bo', 'p_listen' ),
	n_owner: npc( 'n_owner', 'owner', 'Cai', 'p_steal' ),
	n_giver: npc( 'n_giver', 'giver', 'Dee', 'p_work' )
};

function npc( npcId, type, given, parcelId ) {

	return {
		npcId, type, name: { given, family: 'Vale' },
		home: { parcelId, unit: 1 }, family: [], job: { parcelId, role: type },
		routine: [ { days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 0, endMin: 1440, activity: 'working', place: { kind: 'parcel', id: parcelId } } ],
		flags: { dead: false }
	};

}

function simulation() {

	const flags = [];
	return {
		flags,
		getNPC: ( id ) => {

			if ( ! people[ id ] ) throw new Error( `unknown ${id}` );
			return people[ id ];

		},
		findNPCs: ( query ) => Object.values( people ).filter( ( person ) => person.type === query.type ),
		getNPCVendor: ( query ) => Object.values( people ).find( ( person ) => person.type === ( query.npcType ?? query.type ) ) ?? null,
		reserveNPC: ( spec ) => Object.values( people ).find( ( person ) => person.type === ( spec.npcType ?? spec.type ) ),
		behaviorAt: ( id ) => ( {
			mode: 'interior', activity: 'working', place: { kind: 'parcel', id: people[ id ].job.parcelId }, interrupted: false
		} ),
		applyFlag: ( id, op ) => flags.push( { id, op } ),
		interrupt: () => {}, resume: () => {}
	};

}

const pickupDelivery = {
	id: 'q_courier', title: 'Paper trail', premise: 'Move the paper.', roles: [ role( 'giver', 'giver' ) ],
	items: [ { itemId: 'shared_document', name: 'Stamped manifest', description: 'A signed cargo manifest.', kind: 'document', atParcelId: 'p_pickup' } ],
	facts: [], acts: [ { actId: 'act', title: 'Transfer', summary: 'Move the evidence.' } ],
	steps: [
		step( 'take_doc', { kind: 'pickup', itemId: 'shared_document' }, {
			gives: [ 'shared_document' ], hint: 'Take the stamped manifest.', wantedByRoleId: 'giver',
			next: [ { toStepId: 'deliver_doc', when: [] } ]
		} ),
		step( 'deliver_doc', { kind: 'deliver', itemId: 'shared_document', place: { parcelId: 'p_drop' } }, {
			needs: [ 'shared_document' ], hint: 'Deliver the stamped manifest.', wantedByRoleId: 'giver', endingId: 'done'
		} )
	],
	endings: [ { endingId: 'done', title: 'Delivered', epilogue: 'The manifest changed hands.' } ],
	flags: [], entryStepIds: [ 'take_doc' ]
};

const definitions = [
	pickupDelivery,
	oneStepQuest( 'q_observe', { kind: 'observe', districtId: 'd_glass' }, { gives: information( 'scene_notes', 'Scene notes' ), hint: 'Inspect the crash scene.' } ),
	oneStepQuest( 'q_listen', { kind: 'listen', roleIds: [ 'a', 'b' ], atParcelId: 'p_listen' }, {
		roles: [ role( 'a', 'listener_a' ), role( 'b', 'listener_b' ) ],
		gives: information( 'conversation', 'Overheard conversation' ), hint: 'Listen to Aya and Bo.'
	} ),
	oneStepQuest( 'q_steal', { kind: 'steal', itemId: 'owned_chip', fromRoleId: 'owner' }, {
		roles: [ role( 'owner', 'owner' ) ],
		items: [ { itemId: 'owned_chip', name: 'Access chip', description: 'Cai keeps it close.', kind: 'device' } ],
		gives: [ 'owned_chip' ], hint: 'Steal Cai\'s access chip.'
	} ),
	oneStepQuest( 'q_work', { kind: 'work', atParcelId: 'p_work', role: 'maintenance technician' }, { hint: 'Work the maintenance shift.' } )
];

describe( 'QuestActions target contract', () => {

	it( 'projects active mechanics with stable identities, cast actors, symbolic bindings, and item metadata', () => {

		const actions = setup().actions;
		const targets = actions.targets( { timeMin: 600 } );

		expect( targets ).toHaveLength( 5 );
		expect( target( targets, 'q_courier' ) ).toMatchObject( {
			targetKey: 'quest:q_courier:take_doc', kind: 'pickup', place: { kind: 'parcel', id: 'p_pickup' }, actorIds: [],
			item: { id: 'shared_document', name: 'Stamped manifest', kind: 'document', quantity: 1 },
			presentation: {
				name: 'Stamped manifest', icon: 'pickup', highlight: 'outline',
				actions: [
					{ action: 'take', label: 'Take', bindingAction: 'interact', progressesQuest: true },
					{ action: 'read', label: 'Read', bindingAction: 'secondary-interact', progressesQuest: false }
				]
			},
			availability: { available: true }
		} );
		expect( target( targets, 'q_listen' ) ).toMatchObject( {
			kind: 'listen', actorIds: [ 'n_listener_a', 'n_listener_b' ], place: { kind: 'parcel', id: 'p_listen' }
		} );
		expect( target( targets, 'q_steal' ) ).toMatchObject( {
			kind: 'steal', actorIds: [ 'n_owner' ], presentation: { highlight: 'person-outline' }
		} );

	} );

	it( 'validates every public input before reading quest state', () => {

		const actions = setup().actions;
		expect( () => actions.targets( { timeMin: -1 } ) ).toThrowError( QuestActionError );
		expect( () => actions.perform( { targetKey: '', action: 'take', timeMin: 1, playerPlaces: [] } ) ).toThrowError( /interaction-request/ );

	} );

} );

describe( 'QuestActions interaction state', () => {

	it( 'keeps a pickup in the world through place, visibility, occlusion, and reach failures', () => {

		const { actions, session } = setup();
		const base = { targetKey: 'quest:q_courier:take_doc', action: 'take', timeMin: 600 };
		const cases = [
			[ { ...base, playerPlaces: [ { kind: 'parcel', id: 'elsewhere' } ], focus: focus() }, 'wrong_place' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { visible: false } ) }, 'not_visible' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { unobstructed: false } ) }, 'occluded' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { distanceMeters: 2.51 } ) }, 'out_of_reach' ]
		];

		for ( const [ request, code ] of cases ) {

			expect( actions.perform( request ) ).toMatchObject( { ok: false, code, progressed: false, inventory: [], worldChanges: [] } );

		}
		expect( session.inventoryView() ).toEqual( [] );
		expect( actions.targets( { timeMin: 600 } ).some( ( each ) => each.targetKey === base.targetKey ) ).toBe( true );

	} );

	it( 'reads without progress, then transfers one real item and prevents duplicate pickup', () => {

		const { actions } = setup();
		const request = {
			targetKey: 'quest:q_courier:take_doc', timeMin: 600, playerPlaces: at( 'p_pickup' ), focus: focus()
		};

		expect( actions.perform( { ...request, action: 'read' } ) ).toEqual( {
			ok: true, targetKey: request.targetKey, action: 'read', progressed: false,
			message: 'Read Stamped manifest.', readText: 'A signed cargo manifest.', completed: [], inventory: [], worldChanges: []
		} );

		const taken = actions.perform( { ...request, action: 'take' } );
		expect( taken ).toMatchObject( {
			ok: true, progressed: true,
			completed: [ { questId: 'q_courier', stepIds: [ 'take_doc' ] } ],
			inventory: [ { id: 'shared_document', name: 'Stamped manifest', quantity: 1 } ],
			worldChanges: [ { targetKey: request.targetKey, state: 'collected' } ]
		} );
		expect( actions.perform( { ...request, action: 'take' } ) ).toMatchObject( {
			ok: false, code: 'unknown_target', progressed: false,
			inventory: [ { id: 'shared_document', quantity: 1 } ], worldChanges: []
		} );

	} );

	it( 'maps inspect, listen, steal, work, and delivery to the runtime and updates inventory', () => {

		const { actions } = setup();
		const inspect = actions.perform( areaRequest( 'q_observe', 'step', 'inspect', { kind: 'district', id: 'd_glass' } ) );
		expect( inspect ).toMatchObject( { ok: true, completed: [ { questId: 'q_observe', stepIds: [ 'step' ], endingId: 'done' } ] } );

		const listen = actions.perform( {
			...areaRequest( 'q_listen', 'step', 'listen', { kind: 'parcel', id: 'p_listen' } ),
			focus: focus( { visible: false, distanceMeters: 7.99 } )
		} );
		expect( listen ).toMatchObject( { ok: true, completed: [ { questId: 'q_listen', stepIds: [ 'step' ] } ] } );

		const steal = actions.perform( {
			...areaRequest( 'q_steal', 'step', 'steal', { kind: 'parcel', id: 'p_steal' } ), focus: focus( { distanceMeters: 2 } )
		} );
		expect( steal ).toMatchObject( {
			ok: true, inventory: expect.arrayContaining( [ { id: 'owned_chip', name: 'Access chip', quantity: 1, state: expect.any( Object ) } ] ),
			worldChanges: [ { targetKey: 'quest:q_steal:step', state: 'stolen' } ]
		} );

		const work = actions.perform( areaRequest( 'q_work', 'step', 'work', { kind: 'parcel', id: 'p_work' } ) );
		expect( work ).toMatchObject( { ok: true, completed: [ { questId: 'q_work', stepIds: [ 'step' ] } ] } );

		actions.perform( {
			targetKey: 'quest:q_courier:take_doc', action: 'take', timeMin: 600, playerPlaces: at( 'p_pickup' ), focus: focus()
		} );
		const delivered = actions.perform( areaRequest( 'q_courier', 'deliver_doc', 'deliver', { kind: 'parcel', id: 'p_drop' } ) );
		expect( delivered ).toMatchObject( {
			ok: true, completed: [ { questId: 'q_courier', stepIds: [ 'deliver_doc' ], endingId: 'done' } ],
			worldChanges: [ { targetKey: 'quest:q_courier:deliver_doc', state: 'delivered' } ]
		} );
		expect( delivered.inventory.find( ( item ) => item.id === 'shared_document' ) ).toBeUndefined();

	} );

	it( 'advances only the selected quest when another active quest uses the same item id', () => {

		const duplicate = { ...pickupDelivery, id: 'q_duplicate', title: 'Duplicate', steps: [ { ...pickupDelivery.steps[ 0 ], next: [], endingId: 'done' } ] };
		const sim = simulation();
		const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const session = QuestSession.create( [ pickupDelivery, duplicate ], sim, 600 );
		warning.mockRestore();
		const actions = new QuestActions( session );

		actions.perform( {
			targetKey: 'quest:q_courier:take_doc', action: 'take', timeMin: 600, playerPlaces: at( 'p_pickup' ), focus: focus()
		} );

		const activeKeys = actions.targets( { timeMin: 600 } ).map( ( each ) => each.targetKey );
		expect( activeKeys ).toContain( 'quest:q_duplicate:take_doc' );
		expect( session.persistenceView().find( ( quest ) => quest.id === 'q_duplicate' ).completedSteps ).toEqual( [] );

	} );

} );

function setup() {

	const sim = simulation();
	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	const session = QuestSession.create( definitions, sim, 600 );
	warning.mockRestore();
	return { sim, session, actions: new QuestActions( session ) };

}

function target( targets, questId ) {

	return targets.find( ( each ) => each.questId === questId );

}

function at( parcelId ) {

	return [ { kind: 'parcel', id: parcelId } ];

}

function focus( override = {} ) {

	return { visible: true, unobstructed: true, distanceMeters: 1, ...override };

}

function areaRequest( questId, stepId, action, place ) {

	return { targetKey: `quest:${questId}:${stepId}`, action, timeMin: 600, playerPlaces: [ place ] };

}

function role( roleId, npcType ) {

	return { roleId, npcType, persona: `${roleId} is watchful.` };

}

function information( itemId, name ) {

	return [ { itemId, name, description: `${name} recorded in memory.`, kind: 'information' } ];

}

function oneStepQuest( id, targetValue, options = {} ) {

	const items = options.items ?? options.gives ?? [];
	const roles = options.roles ?? [ role( 'giver', 'giver' ) ];
	const gives = Array.isArray( options.gives ) && typeof options.gives[ 0 ] === 'string'
		? options.gives
		: ( options.gives ?? [] ).map( ( item ) => item.itemId );
	return {
		id, title: id, premise: `${id} premise.`, roles, items, facts: [],
		acts: [ { actId: 'act', title: 'Act', summary: 'Complete the objective.' } ],
		steps: [ step( 'step', targetValue, { gives, hint: options.hint, endingId: 'done', wantedByRoleId: roles[ 0 ].roleId } ) ],
		endings: [ { endingId: 'done', title: 'Done', epilogue: `${id} complete.` } ], flags: [], entryStepIds: [ 'step' ]
	};

}

function step( stepId, targetValue, options = {} ) {

	return {
		stepId, actId: 'act',
		narrative: {
			description: `${options.hint ?? stepId} completed.`,
			playerHint: options.hint ?? `Complete ${stepId}.`,
			stake: 'The objective remains unresolved otherwise.'
		},
		...( options.wantedByRoleId ? { wantedByRoleId: options.wantedByRoleId } : {} ),
		target: targetValue, gives: options.gives ?? [], needs: options.needs ?? [], conditions: [], effects: [],
		next: options.next ?? [], branching: 'parallel', ...( options.endingId ? { endingId: options.endingId } : {} )
	};

}
