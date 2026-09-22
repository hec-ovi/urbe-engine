import { describe, expect, it, vi } from 'vitest';
import { QuestActionError } from './QuestActionError.js';
import { QuestActions } from './QuestActions.js';
import { QuestSession } from './QuestSession.js';
import { npc, oneStepQuest, quest, role, simulation, step } from './quest.test-fixtures.js';

const pickupDelivery = quest( 'q_courier', {
	roles: [ role( 'giver', 'giver' ) ],
	items: [ { itemId: 'shared_document', name: 'Stamped manifest', description: 'A signed cargo manifest.', kind: 'document', atParcelId: 'p_pickup' } ],
	steps: [
		step( 'take_doc', { kind: 'pickup', itemId: 'shared_document' }, {
			gives: [ 'shared_document' ], hint: 'Take the stamped manifest.',
			next: [ { toStepId: 'deliver_doc', when: [] } ]
		} ),
		step( 'deliver_doc', { kind: 'deliver', itemId: 'shared_document', place: { parcelId: 'p_drop' } }, {
			needs: [ 'shared_document' ], hint: 'Deliver the stamped manifest.', endingId: 'done'
		} )
	]
} );

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

	it( 'follows a selected active alternative without accepting an ending or changing progress', () => {

		const choice = quest( 'q_choice', { roles: [ role( 'giver', 'giver' ) ], entryStepIds: [ 'publish', 'sell' ], steps: [
			step( 'publish', { kind: 'goto', place: { parcelId: 'p_record' } }, { endingId: 'public' } ),
			step( 'sell', { kind: 'goto', place: { parcelId: 'p_offer' } }, { endingId: 'private' } )
		] } );
		choice.endings = [ { endingId: 'public', title: 'On record', epilogue: 'The evidence is public.' },
			{ endingId: 'private', title: 'The offer', epilogue: 'The evidence remains private.' } ];
		const session = QuestSession.create( [ choice ], people(), 600 );
		const actions = new QuestActions( session ), before = session.snapshot();
		expect( actions.objective( { timeMin: 600, questId: choice.id, stepId: 'sell' } ) )
			.toMatchObject( { stepId: 'sell', place: { id: 'p_offer' } } );
		expect( actions.objective( { timeMin: 600, questId: choice.id, stepId: 'publish' } ) )
			.toMatchObject( { stepId: 'publish', place: { id: 'p_record' } } );
		expect( session.snapshot() ).toEqual( before );

	} );

	it( 'projects active steps with stable identities, cast actors, symbolic bindings, and item metadata', () => {

		const targets = setup().actions.targets( { timeMin: 600 } );

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

	it( 'projects every measured mechanic with exact authored target and resolved cast identities', () => {

		const targets = [
			{ kind: 'assassinate', roleId: 'actor' },
			{ kind: 'rescue', roleId: 'actor', releaseTargetId: 'release', place: { parcelId: 'p_work' }, completionFlag: 'done' },
			{ kind: 'escort', roleId: 'actor', routeId: 'safe', mode: 'follow-player', from: { parcelId: 'p_work' }, to: { parcelId: 'p_drop' }, completionFlag: 'done' },
			{ kind: 'access', accessPointId: 'door', credentialItemId: 'code', place: { parcelId: 'p_work' }, completionFlag: 'done' },
			{ kind: 'hacking', targetId: 'terminal', place: { parcelId: 'p_work' }, completionFlag: 'done' },
			{ kind: 'sabotage', targetId: 'relay', place: { parcelId: 'p_work' }, completionFlag: 'done' },
			{ kind: 'transportation', journeyId: 'ride', mode: 'public-transit', from: { parcelId: 'p_work' }, to: { parcelId: 'p_drop' }, passengerRoleIds: [ 'actor' ], cargoItemIds: [], completionFlag: 'done' }
		];
		const mechanicQuests = targets.map( ( value, index ) => oneStepQuest( `q_mechanic_${index}`, value, {
			roles: [ role( 'actor', 'giver' ) ],
			items: value.kind === 'access' ? [ { itemId: 'code', name: 'Code', description: 'Access code.', kind: 'information' } ] : [],
			needs: value.kind === 'access' ? [ value.credentialItemId ] : []
		} ) );
		const projected = new QuestActions( QuestSession.create( mechanicQuests, people(), 600 ) ).mechanics( { timeMin: 600 } );

		expect( projected.map( ( value ) => value.kind ) ).toEqual( targets.map( ( value ) => value.kind ) );
		expect( projected[ 0 ] ).toMatchObject( {
			targetKey: 'quest:q_mechanic_0:step', actorIds: [ 'n_giver' ], target: targets[ 0 ],
			place: { kind: 'parcel', id: 'p_work' }, availability: { available: true }
		} );
		expect( projected[ 6 ] ).toMatchObject( {
			actorIds: [ 'n_giver' ], target: targets[ 6 ], place: { kind: 'parcel', id: 'p_work' }
		} );

	} );

	it( 'selects the first open objective and publishes its exact guidance destination or closed reason', () => {

		expect( setup().actions.objective( { timeMin: 600 } ) ).toEqual( {
			targetKey: 'quest:q_courier:take_doc', questId: 'q_courier', stepId: 'take_doc', kind: 'pickup',
			title: 'q_courier', text: 'Take the stamped manifest.', place: { kind: 'parcel', id: 'p_pickup' },
			actorIds: [], venue: null, window: null, availability: { available: true },
			guidance: {
				questId: 'q_courier', stepId: 'take_doc', place: { kind: 'parcel', id: 'p_pickup' },
				destination: { kind: 'parcel', id: 'p_pickup' }
			}
		} );

		// A place the questline names is the venue the HUD and the sign read, and
		// the hour its step names is carried with whether it is open now.
		const window = { label: 'during the slow hour', days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 1080, endMin: 1380 };
		const named = oneStepQuest( 'q_named', { kind: 'goto', place: { parcelId: 'p_pickup', name: 'Oxide Filter' } }, { hint: 'Go there during the slow hour.' } );
		named.steps[ 0 ].window = window;
		const objective = new QuestActions( QuestSession.create( [ named ], people(), 600 ) ).objective( { timeMin: 600 } );
		expect( objective ).toMatchObject( { kind: 'goto', venue: 'Oxide Filter', actorIds: [], window, availability: { available: false, reason: 'outside_window' } } );

		for ( const [ kind, id, place ] of [
			[ 'station', 'central', { stationId: 'central' } ], [ 'stop', 'night-bus', { stopId: 'night-bus' } ]
		] ) {

			const session = QuestSession.create( [ oneStepQuest( `q_${kind}`, { kind: 'goto', place } ) ], people(), 600 );
			const objective = new QuestActions( session ).objective( { timeMin: 600 } );
			expect( objective.place ).toEqual( { kind, id } );
			expect( objective.guidance ).toEqual( { questId: `q_${kind}`, stepId: 'step', place: { kind, id }, destination: { kind, id } } );

		}

		const area = QuestSession.create( [ oneStepQuest(
			'q_area', { kind: 'observe', districtId: 'd_glass' }, { gives: information( 'area-notes', 'Area notes' ) }
		) ], people(), 600 );
		expect( new QuestActions( area ).objective( { timeMin: 600 } ).guidance ).toEqual( {
			questId: 'q_area', stepId: 'step', place: { kind: 'district', id: 'd_glass' }, reason: 'district-area'
		} );

	} );

	it( 'follows the questline the player picked and marks every questline\'s open place', () => {

		const goto = ( id, parcelId ) => oneStepQuest( id, { kind: 'goto', place: { parcelId } }, { hint: `Go to ${parcelId}.` } );
		const talk = oneStepQuest( 'q_side_talk', { kind: 'talk', roleId: 'giver', atParcelId: 'p_work' }, { hint: 'Hear the giver out.' } );
		const { actions } = setup( [ goto( 'q_main', 'p_pickup' ), goto( 'q_side', 'p_drop' ), talk ] );

		// No pick: the main story, which is written first.
		expect( actions.objective( { timeMin: 600 } ) ).toMatchObject( { questId: 'q_main', place: { kind: 'parcel', id: 'p_pickup' } } );
		expect( actions.objective( { timeMin: 600, questId: 'q_side' } ) ).toMatchObject( {
			questId: 'q_side', text: 'Go to p_drop.', place: { kind: 'parcel', id: 'p_drop' },
			guidance: { questId: 'q_side', stepId: 'step', place: { kind: 'parcel', id: 'p_drop' }, destination: { kind: 'parcel', id: 'p_drop' } }
		} );
		// A questline with nothing open falls back to the first that has.
		expect( actions.objective( { timeMin: 600, questId: 'q_unknown' } ).questId ).toBe( 'q_main' );

		// Every open place stands on its own, whichever one is being followed.
		expect( actions.places( { timeMin: 600 } ) ).toMatchObject( [
			{ questId: 'q_main', kind: 'goto', place: { kind: 'parcel', id: 'p_pickup' }, actorIds: [] },
			{ questId: 'q_side', kind: 'goto', place: { kind: 'parcel', id: 'p_drop' }, actorIds: [] },
			{ questId: 'q_side_talk', kind: 'talk', place: { kind: 'parcel', id: 'p_work' }, actorIds: [ 'n_giver' ] }
		] );

	} );

	it( 'says why a closed target is closed, with the hour when its step names one', () => {

		expect( QuestActions.unavailableMessage( 'off_duty' ) ).toBe( 'The person required by this objective is not at the target location now.' );
		expect( QuestActions.unavailableMessage( 'outside_window', { label: 'the slow hour', days: [ 0 ], startMin: 1080, endMin: 1380 } ) )
			.toBe( 'This objective is open at another hour. Open 18:00 to 23:00.' );

	} );

} );

describe( 'QuestActions interaction state', () => {

	it( 'reads in place, then maps every player action to the runtime and moves inventory once', () => {

		const { actions, session } = setup();
		const pickup = { targetKey: 'quest:q_courier:take_doc', timeMin: 600, playerPlaces: at( 'p_pickup' ), focus: focus() };

		expect( actions.perform( { ...pickup, action: 'read' } ) ).toEqual( {
			ok: true, targetKey: pickup.targetKey, action: 'read', progressed: false,
			message: 'Read Stamped manifest.', readText: 'A signed cargo manifest.', completed: [], inventory: [], worldChanges: []
		} );

		expect( actions.perform( { ...pickup, action: 'take' } ) ).toMatchObject( {
			ok: true, progressed: true,
			completed: [ { questId: 'q_courier', stepIds: [ 'take_doc' ] } ],
			inventory: [ { id: 'shared_document', name: 'Stamped manifest', quantity: 1 } ],
			worldChanges: [ { targetKey: pickup.targetKey, state: 'collected' } ]
		} );
		expect( actions.perform( { ...pickup, action: 'take' } ) ).toMatchObject( {
			ok: false, code: 'unknown_target', progressed: false,
			inventory: [ { id: 'shared_document', quantity: 1 } ], worldChanges: []
		} );

		expect( actions.perform( areaRequest( 'q_observe', 'step', 'inspect', { kind: 'district', id: 'd_glass' } ) ) )
			.toMatchObject( { ok: true, completed: [ { questId: 'q_observe', stepIds: [ 'step' ], endingId: 'done' } ] } );
		expect( actions.perform( {
			...areaRequest( 'q_listen', 'step', 'listen', { kind: 'parcel', id: 'p_listen' } ),
			focus: focus( { visible: false, distanceMeters: 7.99 } )
		} ) ).toMatchObject( { ok: true, completed: [ { questId: 'q_listen', stepIds: [ 'step' ] } ] } );
		expect( actions.perform( {
			...areaRequest( 'q_steal', 'step', 'steal', { kind: 'parcel', id: 'p_steal' } ), focus: focus( { distanceMeters: 2 } )
		} ) ).toMatchObject( {
			ok: true, inventory: expect.arrayContaining( [ { id: 'owned_chip', name: 'Access chip', quantity: 1, state: expect.any( Object ) } ] ),
			worldChanges: [ { targetKey: 'quest:q_steal:step', state: 'stolen' } ]
		} );
		expect( actions.perform( areaRequest( 'q_work', 'step', 'work', { kind: 'parcel', id: 'p_work' } ) ) )
			.toMatchObject( { ok: true, completed: [ { questId: 'q_work', stepIds: [ 'step' ] } ] } );

		const delivered = actions.perform( areaRequest( 'q_courier', 'deliver_doc', 'deliver', { kind: 'parcel', id: 'p_drop' } ) );
		expect( delivered ).toMatchObject( {
			ok: true, completed: [ { questId: 'q_courier', stepIds: [ 'deliver_doc' ], endingId: 'done' } ],
			worldChanges: [ { targetKey: 'quest:q_courier:deliver_doc', state: 'delivered' } ]
		} );
		expect( delivered.inventory.find( ( item ) => item.id === 'shared_document' ) ).toBeUndefined();
		expect( session.persistenceView().find( ( value ) => value.id === 'q_courier' ).state ).toBe( 'completed' );

	} );

	it( 'keeps a pickup in the world through every closed failure and never advances another questline', () => {

		const duplicate = { ...pickupDelivery, id: 'q_duplicate', steps: [ { ...pickupDelivery.steps[ 0 ], next: [], endingId: 'done' } ] };
		const { actions, session } = setup( [ pickupDelivery, duplicate ] );
		const base = { targetKey: 'quest:q_courier:take_doc', action: 'take', timeMin: 600 };

		for ( const [ request, code ] of [
			[ { ...base, playerPlaces: [ { kind: 'parcel', id: 'elsewhere' } ], focus: focus() }, 'wrong_place' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { visible: false } ) }, 'not_visible' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { unobstructed: false } ) }, 'occluded' ],
			[ { ...base, playerPlaces: at( 'p_pickup' ), focus: focus( { distanceMeters: 2.51 } ) }, 'out_of_reach' ]
		] ) {

			expect( actions.perform( request ) ).toMatchObject( { ok: false, code, progressed: false, inventory: [], worldChanges: [] } );

		}
		expect( session.inventoryView() ).toEqual( [] );

		actions.perform( { ...base, playerPlaces: at( 'p_pickup' ), focus: focus() } );
		const keys = actions.targets( { timeMin: 600 } ).map( ( each ) => each.targetKey );
		expect( keys ).toContain( 'quest:q_duplicate:take_doc' );
		expect( session.persistenceView().find( ( value ) => value.id === 'q_duplicate' ).completedSteps ).toEqual( [] );

		expect( () => actions.targets( { timeMin: -1 } ) ).toThrowError( QuestActionError );
		expect( () => actions.perform( { targetKey: '', action: 'take', timeMin: 1, playerPlaces: [] } ) ).toThrowError( /interaction-request/ );

	} );

} );

function people() {

	return simulation( new Map( [
		[ 'n_listener_a', npc( 'n_listener_a', 'listener_a', 'p_listen' ) ],
		[ 'n_listener_b', npc( 'n_listener_b', 'listener_b', 'p_listen' ) ],
		[ 'n_owner', npc( 'n_owner', 'owner', 'p_steal' ) ],
		[ 'n_giver', npc( 'n_giver', 'giver', 'p_work' ) ]
	] ) );

}

function setup( quests = definitions ) {

	const warning = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	const session = QuestSession.create( quests, people(), 600 );
	warning.mockRestore();
	return { session, actions: new QuestActions( session ) };

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

function information( itemId, name ) {

	return [ { itemId, name, description: `${name} recorded in memory.`, kind: 'information' } ];

}
