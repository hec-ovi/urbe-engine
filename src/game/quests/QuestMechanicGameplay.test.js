import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { QuestActions } from './QuestActions.js';
import { QuestGameplay } from './QuestGameplay.js';
import { QuestMechanics } from './QuestMechanics.js';
import { QuestSession } from './QuestSession.js';
import { MissionItemAssets } from './MissionItemAssets.js';

const TIME = 600;
const P4 = { kind: 'parcel', id: 'p4' };
const P7 = { kind: 'parcel', id: 'p7' };

describe( 'live measured quest mechanic hosts', () => {

	it( 'runs fixed interactions, a passenger transit journey and a fatal impact through QuestGameplay', () => {

		const harness = setup( [ fixedDefinition(), assassinationDefinition() ] );
		for ( const [ kind, eventKind ] of [
			[ 'hacking', 'hacked' ], [ 'access', 'accessed' ], [ 'rescue', 'released' ], [ 'sabotage', 'sabotaged' ]
		] ) {

			const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 0.75, -2 ] ) )
				.find( ( value ) => value.interaction.targetKey.endsWith( `:${kind}` ) );
			expect( candidate, kind ).toBeDefined();
			const result = harness.gameplay.perform( {
				targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
			} );
			expect( result ).toMatchObject( { ok: true, eventKind, progressed: true } );

		}

		const boarded = {
			action: 'board', result: {
				ok: true, service: { tripId: 'trip-live', routeId: 'route-live' }, state: { status: 'aboard' }
			}
		};
		expect( harness.gameplay.transitEvent( boarded, {
			timeMin: TIME, playerPlaces: [ P4 ], position: [ 0, 0, -2 ]
		} ) ).toBeNull();
		expect( harness.continuity.carryFollower ).toHaveBeenCalledWith( {
			npcId: 'npc.witness', position: [ 0, 0, -2 ], routeId: 'route-live'
		} );
		harness.gameplay.transitEvent( {
			action: 'update', result: { ok: true, tripId: 'trip-live', routeId: 'route-live', autoDisembarked: false }
		}, { timeMin: TIME, playerPlaces: [], position: [ 5, 1, -2 ] } );
		const transported = harness.gameplay.transitEvent( {
			action: 'disembark', result: { ok: true, tripId: 'trip-live', routeId: 'route-live' }
		}, { timeMin: TIME, playerPlaces: [ P7 ], position: [ 10, 0, -2 ] } );
		expect( transported ).toMatchObject( { ok: true, eventKind: 'transported', progressed: true } );
		expect( harness.continuity.stopFollow ).toHaveBeenCalled();

		const fatal = harness.gameplay.fatalImpact( {
			personId: 'npc.mark', vehicleId: 'car.live', impactSpeed: 12, fatal: true,
			point: { x: 0, y: 1, z: 0 }, impulse: { x: 0, y: 9, z: 90 }
		}, TIME );
		expect( fatal ).toMatchObject( { ok: true, eventKind: 'killed', progressed: true } );
		expect( harness.people.get( 'npc.mark' ).flags.dead ).toBe( true );

	} );

	it.each( [ 'follow-player', 'lead-player' ] )( 'starts %s continuity at the exact source and completes only with actor and player at the destination', ( mode ) => {

		const harness = setup( [ escortDefinition( mode ) ] );
		const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) )[ 0 ];
		expect( candidate.interaction.prompt ).toContain( 'escort' );
		expect( harness.gameplay.perform( {
			targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
		} ) ).toBeNull();
		expect( mode === 'lead-player' ? harness.continuity.startLead : harness.continuity.startFollow ).toHaveBeenCalled();

		harness.control.actor.position = [ 10, 0, -2 ];
		harness.control.actor.animation = 'idle';
		harness.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( harness.gameplay.drainMechanicResults()[ 0 ] ).toMatchObject( {
			ok: true, eventKind: 'escorted', progressed: true
		} );
		expect( harness.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );

	} );

	it( 'does not complete transport at a wrong destination or from a different trip', () => {

		const harness = setup( [ transportDefinition() ] );
		harness.gameplay.transitEvent( {
			action: 'board', result: { ok: true, service: { tripId: 'trip-live', routeId: 'route-live' } }
		}, { timeMin: TIME, playerPlaces: [ P4 ], position: [ 0, 0, 0 ] } );
		expect( harness.gameplay.transitEvent( {
			action: 'disembark', result: { ok: true, tripId: 'other', routeId: 'route-live' }
		}, { timeMin: TIME, playerPlaces: [ P7 ], position: [ 10, 0, 0 ] } ) ).toBeNull();
		expect( harness.gameplay.transitEvent( {
			action: 'disembark', result: { ok: true, tripId: 'trip-live', routeId: 'route-live' }
		}, { timeMin: TIME, playerPlaces: [ P4 ], position: [ 0, 0, 0 ] } ) ).toBeNull();
		expect( harness.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );
		expect( harness.session.persistenceView()[ 0 ].completedSteps ).toEqual( [] );

	} );

	it( 'does not board an authored passenger who is absent from the origin', () => {

		const harness = setup( [ transportDefinition() ] );
		harness.control.actor.position = [ 30, 0, -2 ];
		harness.gameplay.transitEvent( {
			action: 'board', result: { ok: true, service: { tripId: 'trip-live', routeId: 'route-live' } }
		}, { timeMin: TIME, playerPlaces: [ P4 ], position: [ 0, 0, -2 ] } );
		expect( harness.continuity.startFollow ).not.toHaveBeenCalled();
		expect( harness.continuity.carryFollower ).not.toHaveBeenCalled();

	} );

} );

function setup( definitions ) {

	const people = new Map( [
		[ 'npc.witness', npc( 'npc.witness', 'witness' ) ],
		[ 'npc.mark', npc( 'npc.mark', 'mark' ) ]
	] );
	const sim = {
		getNPC: ( id ) => people.get( id ) ?? fail( id ),
		findNPCs: ( query ) => [ ...people.values() ].filter( ( person ) => person.type === query.type ),
		getNPCVendor: ( query ) => [ ...people.values() ].find( ( person ) => person.type === ( query.npcType ?? query.type ) ),
		reserveNPC: ( query ) => [ ...people.values() ].find( ( person ) => person.type === ( query.npcType ?? query.type ) ),
		behaviorAt: ( id ) => ( { mode: 'interior', activity: 'working', place: { kind: 'parcel', id: people.get( id ).parcelId }, interrupted: false } ),
		applyFlag: ( id, operation ) => { if ( operation.kind === 'die' ) people.get( id ).flags.dead = true; },
		interrupt() {}, resume() {}
	};
	const session = QuestSession.create( definitions, sim, TIME );
	const control = {
		actor: actor(),
		follow: null
	};
	const continuity = {
		serialize: vi.fn( () => ( {
			version: '1', actors: [ structuredClone( control.actor ) ], follow: control.follow, conversation: null, pose: null
		} ) ),
		startFollow: vi.fn( ( request ) => {

			control.actor.npcId = request.npcId;
			control.actor.mode = 'following';
			control.follow = { npcId: request.npcId, mode: 'following' };
			return structuredClone( control.actor );

		} ),
		startLead: vi.fn( ( request ) => {

			control.actor.npcId = request.npcId;
			control.actor.mode = 'leading';
			control.follow = { npcId: request.npcId, mode: 'leading' };
			return structuredClone( control.actor );

		} ),
		carryFollower: vi.fn( ( request ) => {

			control.actor.position = [ ...request.position ];
			return structuredClone( control.actor );

		} ),
		stopFollow: vi.fn( () => {

			control.actor.mode = 'resuming';
			control.follow = null;
			return structuredClone( control.actor );

		} )
	};
	const crowd = {
		questMember: vi.fn( ( npcId ) => ( { npcId, position: new THREE.Vector3().fromArray( control.actor.position ) } ) ),
		syncActor: vi.fn()
	};
	const gameplay = new QuestGameplay( {
		session, actions: new QuestActions( session ), mechanics: new QuestMechanics( session ),
		world: { parcels: [ { id: 'p4', anchor: [ 0, 0, -2 ] }, { id: 'p7', anchor: [ 10, 0, -2 ] } ] },
		crowd, continuity, missionItems: missionAssets(),
		physics: { rapier: null, world: null }, playerCollider: null,
		materialFactory: { build: () => new THREE.MeshStandardMaterial( { color: 0x223344 } ) }
	} );
	return { gameplay, session, continuity, control, people };

}

function fixedDefinition() {

	const kinds = [
		[ 'hacking', { targetId: 'archive-index' } ],
		[ 'access', { accessPointId: 'archive-door', credentialItemId: 'entry-code' } ],
		[ 'rescue', { roleId: 'witness', releaseTargetId: 'witness-release' } ],
		[ 'sabotage', { targetId: 'alarm-relay' } ]
	];
	const steps = kinds.map( ( [ kind, fields ], index ) => step( kind, {
		kind, ...fields, place: { parcelId: 'p4' }, completionFlag: `${kind}-done`
	}, index === kinds.length - 1 ? 'transportation' : kinds[ index + 1 ][ 0 ] ) );
	steps.push( step( 'transportation', transportationTarget( [ 'entry-code' ] ), null, 'safe' ) );
	return definition( 'fixed', [ role( 'witness', 'witness' ) ], steps, [
		{ itemId: 'entry-code', name: 'Entry code', description: 'Archive credential device.', kind: 'device' }
	], [ ...kinds.map( ( [ kind ] ) => `${kind}-done` ), 'transport-done' ], 'hacking', 'safe' );

}

function transportDefinition() {

	return definition( 'transport-only', [ role( 'witness', 'witness' ) ], [
		step( 'transportation', transportationTarget(), null, 'safe' )
	], [], [ 'transport-done' ], 'transportation', 'safe' );

}

function transportationTarget( cargoItemIds = [] ) {

	return {
		kind: 'transportation', journeyId: 'archive-to-market', mode: 'public-transit',
		from: { parcelId: 'p4' }, to: { parcelId: 'p7' }, passengerRoleIds: [ 'witness' ],
		cargoItemIds, completionFlag: 'transport-done'
	};

}

function escortDefinition( mode ) {

	return definition( `escort-${mode}`, [ role( 'witness', 'witness' ) ], [ step( 'escort', {
		kind: 'escort', roleId: 'witness', routeId: 'safe-route', mode,
		from: { parcelId: 'p4' }, to: { parcelId: 'p7' }, completionFlag: 'escort-done'
	}, null, 'safe' ) ], [], [ 'escort-done' ], 'escort', 'safe' );

}

function assassinationDefinition() {

	return definition( 'assassination', [ role( 'mark', 'mark' ) ], [
		step( 'assassinate', { kind: 'assassinate', roleId: 'mark' }, null, 'stopped' )
	], [], [], 'assassinate', 'stopped' );

}

function definition( id, roles, steps, items, flags, entry, ending ) {

	return {
		id, title: id, premise: id, roles, items, facts: [],
		acts: [ { actId: 'act', title: id, summary: id } ], steps,
		endings: [ { endingId: ending, title: ending, epilogue: ending } ], flags, entryStepIds: [ entry ]
	};

}

function step( stepId, target, next, endingId ) {

	return {
		stepId, actId: 'act', narrative: { description: `${stepId} done`, playerHint: stepId, stake: stepId },
		wantedByRoleId: target.roleId ?? 'witness', target, gives: stepId === 'hacking' ? [ 'entry-code' ] : [],
		needs: stepId === 'access' ? [ 'entry-code' ] : target.kind === 'transportation' ? [ ...target.cargoItemIds ] : [], conditions: [],
		effects: target.completionFlag ? [ { kind: 'setFlag', flag: target.completionFlag } ] : [],
		next: next ? [ { toStepId: next, when: [] } ] : [], branching: 'parallel', ...( endingId ? { endingId } : {} )
	};

}

function missionAssets() {

	const request = {
		contractVersion: '1.0', assetId: 'quest.fixed.terminal', purpose: 'Fixed quest terminal', family: 'control-terminal',
		dimensions: { width: 0.9, height: 1.35, depth: 0.55 },
		materials: [
			{ slot: 'surface', key: 'cyberpunk/metal/mid', variantId: 'paint' },
			{ slot: 'display', key: 'cyberpunk/ad-screen/mid', variantId: 'noir-cyan' }
		],
		requiredInteractions: [ 'use', 'access', 'hack', 'sabotage' ],
		clearance: { approachDepth: 0.75, sideMargin: 0.2, overhead: 0.1 }, seed: 72
	};
	return new MissionItemAssets( {
		requests: [ request ], bindings: [], materialCatalog: {
			contractVersion: '1.0', entries: [
				{ key: 'cyberpunk/metal/mid', variants: [ 'paint' ] },
				{ key: 'cyberpunk/ad-screen/mid', variants: [ 'noir-cyan' ] }
			]
		},
		mechanicBindings: [
			[ 'hacking', 'targetId', 'archive-index', 'hack' ],
			[ 'access', 'accessPointId', 'archive-door', 'access' ],
			[ 'rescue', 'releaseTargetId', 'witness-release', 'use' ],
			[ 'sabotage', 'targetId', 'alarm-relay', 'sabotage' ]
		].map( ( [ stepId, field, value, interactionId ] ) => ( {
			questId: 'fixed', stepId, [ field ]: value, assetId: request.assetId, interactionId
		} ) )
	} );

}

function frame( place, feet, focus ) {

	const eye = new THREE.Vector3( feet[ 0 ], 1.7, feet[ 2 ] );
	return {
		timeMin: TIME, playerPlaces: [ place ], feet: record( new THREE.Vector3().fromArray( feet ) ),
		eye: record( eye ), look: record( new THREE.Vector3().fromArray( focus ).sub( eye ).normalize() )
	};

}

function actor() {

	return {
		npcId: 'npc.witness', position: [ 0, 0, -2 ], animation: 'idle', mode: 'schedule'
	};

}

function npc( npcId, type ) {

	return {
		npcId, type, parcelId: 'p4', name: { given: type, family: 'Vale' }, home: { parcelId: 'p4', unit: 1 },
		family: [], job: { parcelId: 'p4', role: type }, routine: [], flags: { dead: false }
	};

}

function role( roleId, npcType ) { return { roleId, npcType, persona: roleId }; }
function record( vector ) { return { x: vector.x, y: vector.y, z: vector.z }; }
function fail( id ) { throw new Error( `unknown ${id}` ); }
