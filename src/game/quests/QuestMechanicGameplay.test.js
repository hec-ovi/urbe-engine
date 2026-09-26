import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { QuestActions } from './QuestActions.js';
import { QuestGameplay } from './QuestGameplay.js';
import { QuestMechanics } from './QuestMechanics.js';
import { QuestSession } from './QuestSession.js';
import { MissionItemAssets } from './MissionItemAssets.js';
import { npc, quest, role, simulation, step } from './quest.test-fixtures.js';

const TIME = 600;
const P4 = { kind: 'parcel', id: 'p4' };
const P7 = { kind: 'parcel', id: 'p7' };

describe( 'live measured quest mechanic hosts', () => {

	it( 'runs fixed interactions, a passenger transit journey and a fatal impact through QuestGameplay', () => {

		const harness = setup( [ fixedDefinition(), assassinationDefinition() ] );
		const firstFrame = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 0.75, -2 ] ) );
		expect( firstFrame.some( ( candidate ) => candidate.interaction.targetKey.includes( 'assassination' ) ) ).toBe( false );
		expect( harness.crowd.questMember ).toHaveBeenCalledWith(
			'npc.mark', TIME, expect.any( THREE.Vector3 ), P4, expect.any( THREE.Vector3 )
		);
		for ( const [ kind, eventKind ] of [
			[ 'hacking', 'hacked' ], [ 'access', 'accessed' ], [ 'rescue', 'released' ], [ 'sabotage', 'sabotaged' ]
		] ) {

			const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 0.75, -2 ] ) )
				.find( ( value ) => value.interaction.targetKey.endsWith( `:${kind}` ) );
			expect( candidate, kind ).toBeDefined();
			expect( harness.gameplay.perform( {
				targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
			} ) ).toMatchObject( { ok: true, eventKind, progressed: true } );

		}

		expect( harness.gameplay.transitEvent( {
			action: 'board', result: { ok: true, service: { tripId: 'trip-live', routeId: 'route-live' }, state: { status: 'aboard' } }
		}, { timeMin: TIME, playerPlaces: [ P4 ], position: [ 0, 0, -2 ] } ) ).toBeNull();
		expect( harness.continuity.carryFollower ).toHaveBeenCalledWith( {
			npcId: 'npc.witness', position: [ 0, 0, -2 ], routeId: 'route-live'
		} );
		harness.gameplay.transitEvent( {
			action: 'update', result: { ok: true, tripId: 'trip-live', routeId: 'route-live', autoDisembarked: false }
		}, { timeMin: TIME, playerPlaces: [], position: [ 5, 1, -2 ] } );
		expect( harness.gameplay.transitEvent( {
			action: 'disembark', result: { ok: true, tripId: 'trip-live', routeId: 'route-live' }
		}, { timeMin: TIME, playerPlaces: [ P7 ], position: [ 10, 0, -2 ] } ) )
			.toMatchObject( { ok: true, eventKind: 'transported', progressed: true } );
		expect( harness.continuity.stopFollow ).toHaveBeenCalled();

		const fatal = harness.gameplay.fatalImpact( impact( 'npc.mark' ), 'npc.mark', TIME );
		expect( fatal ).toMatchObject( { ok: true, eventKind: 'killed', progressed: true } );
		expect( harness.people.get( 'npc.mark' ).flags.dead ).toBe( true );

	} );

	it( 'materializes a previously absent assassination body without advertising an interaction', () => {

		const harness = setup( [ assassinationDefinition() ], { initiallyEmpty: true } );
		expect( harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) ) ).toEqual( [] );
		expect( harness.control.actors.map( ( value ) => value.npcId ) ).toEqual( [ 'npc.mark' ] );

		expect( harness.gameplay.fatalImpact( impact( 'crowd-body-7' ), 'npc.mark', TIME ) )
			.toMatchObject( { ok: true, eventKind: 'killed', progressed: true } );
		expect( harness.people.get( 'npc.mark' ).flags.dead ).toBe( true );

	} );

	it( 'acquires rescue follow before progress, and releases it again when control or the runtime refuses', () => {

		const accepted = setup( [ rescueDefinition() ] );
		expect( rescue( accepted ) ).toMatchObject( { ok: true, eventKind: 'released', progressed: true } );
		expect( accepted.control.follow ).toEqual( { npcId: 'npc.witness', mode: 'following' } );
		expect( accepted.continuity.startFollow ).toHaveBeenCalledWith( {
			npcId: 'npc.witness', timeMin: TIME, playerPosition: [ 0, 0, 0 ]
		} );

		const busy = setup( [ rescueDefinition() ] );
		busy.control.follow = { npcId: 'npc.mark', mode: 'following' };
		expect( rescue( busy ) ).toMatchObject( { ok: false, code: 'runtime_rejected', progressed: false } );
		expect( busy.continuity.startFollow ).not.toHaveBeenCalled();
		expect( busy.control.follow ).toEqual( { npcId: 'npc.mark', mode: 'following' } );
		expect( busy.session.persistenceView()[ 0 ].completedSteps ).toEqual( [] );

		const rejected = setup( [ rescueDefinition() ] );
		vi.spyOn( rejected.mechanics, 'complete' ).mockImplementation( ( request ) =>
			rejected.mechanics.reject( request, 'quest runtime unavailable' ) );
		expect( rescue( rejected ) ).toMatchObject( { ok: false, code: 'runtime_rejected', progressed: false } );
		expect( rejected.continuity.startFollow ).toHaveBeenCalledOnce();
		expect( rejected.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );
		expect( rejected.control.follow ).toBeNull();
		expect( rejected.session.persistenceView()[ 0 ].completedSteps ).toEqual( [] );

	} );

	it( 'starts escort continuity at the exact source and completes only with actor and player at the destination', () => {

		const harness = setup( [ escortDefinition( 'follow-player' ) ] );
		const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) )[ 0 ];
		expect( candidate.interaction.prompt ).toContain( 'escort' );
		expect( harness.gameplay.perform( {
			targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
		} ) ).toBeNull();
		expect( harness.continuity.startFollow ).toHaveBeenCalled();

		harness.control.actor.position = [ 10, 0, -2 ];
		harness.control.actor.animation = 'idle';
		harness.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( harness.gameplay.drainMechanicResults()[ 0 ] ).toMatchObject( {
			ok: true, eventKind: 'escorted', progressed: true
		} );
		expect( harness.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );

	} );

	it( 'completes a lead escort only once the leader has arrived, before letting it go', () => {

		const harness = setup( [ escortDefinition( 'lead-player' ) ] );
		startEscort( harness );
		expect( harness.continuity.startLead ).toHaveBeenCalledWith( {
			npcId: 'npc.witness', timeMin: TIME, destination: { kind: 'parcel', id: 'p7' }
		} );
		const complete = harness.mechanics.complete.bind( harness.mechanics );
		const controlAtCompletion = [];
		vi.spyOn( harness.mechanics, 'complete' ).mockImplementation( ( request ) => {

			controlAtCompletion.push( harness.control.follow?.mode ?? null );
			return complete( request );

		} );

		// Standing still waiting for the player is not arriving.
		harness.control.actor.position = [ 10, 0, -2 ];
		harness.control.phase = 'waiting';
		harness.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( harness.gameplay.drainMechanicResults() ).toEqual( [] );

		harness.control.phase = 'arrived';
		harness.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( harness.gameplay.drainMechanicResults()[ 0 ] ).toMatchObject( { ok: true, eventKind: 'escorted', progressed: true } );
		expect( controlAtCompletion ).toEqual( [ 'leading' ] );
		expect( harness.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );
		expect( harness.gameplay.serializeEscort() ).toBeNull();

	} );

	it( 'walks a lead escort to a station as its continuity stop', () => {

		const harness = setup( [ escortDefinition( 'lead-player', { stationId: 'station-b' } ) ] );
		startEscort( harness );
		expect( harness.continuity.startLead ).toHaveBeenCalledWith( {
			npcId: 'npc.witness', timeMin: TIME, destination: { kind: 'stop', id: 'station-b' }
		} );

	} );

	it( 'saves an active escort and takes it back after a reload', () => {

		const source = setup( [ escortDefinition( 'lead-player' ) ] );
		startEscort( source );
		const state = source.gameplay.serializeEscort();
		expect( state ).toEqual( { questId: 'escort-lead-player', stepId: 'escort', npcId: 'npc.witness', mode: 'lead-player' } );

		const reloaded = setup( [ escortDefinition( 'lead-player' ) ] );
		reloaded.control.follow = { npcId: 'npc.witness', mode: 'leading' };
		expect( reloaded.gameplay.restoreEscort( { timeMin: TIME, state } ) ).toBe( true );
		expect( reloaded.gameplay.serializeEscort() ).toEqual( state );
		reloaded.control.actor.position = [ 10, 0, -2 ];
		reloaded.control.phase = 'arrived';
		reloaded.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( reloaded.gameplay.drainMechanicResults()[ 0 ] ).toMatchObject( { ok: true, eventKind: 'escorted' } );

		// A companion in another mode is not this escort: it is let go.
		const stale = setup( [ escortDefinition( 'lead-player' ) ] );
		stale.control.follow = { npcId: 'npc.witness', mode: 'following' };
		expect( stale.gameplay.restoreEscort( { timeMin: TIME, state } ) ).toBe( false );
		expect( stale.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );
		expect( setup( [ escortDefinition( 'lead-player' ) ] ).gameplay.restoreEscort( { timeMin: TIME, state: null } ) ).toBe( false );

	} );

	it( 'ends an escort whose leader gave up and offers it again', () => {

		const harness = setup( [ escortDefinition( 'lead-player' ) ] );
		const candidate = startEscort( harness );
		expect( harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) ) ).toEqual( [] );
		harness.control.follow = null;
		const offered = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) );
		expect( offered.map( ( value ) => value.interaction.targetKey ) ).toEqual( [ candidate.interaction.targetKey ] );
		expect( harness.gameplay.serializeEscort() ).toBeNull();

	} );

	it( 'ends an escort once, saying why, when its hour closes and offers it again in that hour', () => {

		const definition = escortDefinition( 'lead-player' );
		definition.steps[ 0 ].window = { label: 'the morning', days: [ 0, 1, 2, 3, 4, 5, 6 ], startMin: 540, endMin: 630 };
		const harness = setup( [ definition ] );
		const candidate = startEscort( harness );
		const complete = vi.spyOn( harness.mechanics, 'complete' );
		harness.control.actor.position = [ 10, 0, -2 ];
		harness.control.phase = 'arrived';
		const late = { ...frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ), timeMin: 700 };
		for ( let index = 0; index < 5; index ++ ) harness.gameplay.candidates( late );
		expect( harness.gameplay.drainMechanicResults() ).toEqual( [
			expect.objectContaining( { ok: false, progressed: false, message: 'This objective is open at another hour.' } )
		] );
		expect( complete ).not.toHaveBeenCalled();
		expect( harness.continuity.stopFollow ).toHaveBeenCalledTimes( 1 );
		expect( harness.gameplay.serializeEscort() ).toBeNull();

		// Home again in its hour, the open step is offered again.
		harness.control.actor.position = [ 0, 0, -2 ];
		const offered = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) );
		expect( offered.map( ( value ) => value.interaction.targetKey ) ).toEqual( [ candidate.interaction.targetKey ] );

	} );

	it( 'ends an escort whose completion is rejected once, and lets its NPC go', () => {

		const harness = setup( [ escortDefinition( 'lead-player' ) ] );
		startEscort( harness );
		const complete = vi.spyOn( harness.mechanics, 'complete' )
			.mockImplementation( ( request ) => harness.mechanics.reject( request, 'Refused.' ) );
		harness.control.actor.position = [ 10, 0, -2 ];
		harness.control.phase = 'arrived';
		for ( let index = 0; index < 5; index ++ ) harness.gameplay.candidates( frame( P7, [ 10, 0, 0 ], [ 10, 1.3, -2 ] ) );
		expect( harness.gameplay.drainMechanicResults() ).toEqual( [ expect.objectContaining( { ok: false, message: 'Refused.' } ) ] );
		expect( complete ).toHaveBeenCalledTimes( 1 );
		expect( harness.continuity.stopFollow ).toHaveBeenCalledTimes( 1 );
		expect( harness.gameplay.serializeEscort() ).toBeNull();

	} );

	it( 'keeps the passenger from parcel to boarding and from disembarkation to the authored destination only', () => {

		const harness = setup( [ transportDefinition() ] );
		harness.gameplay.candidates( frame( P4, [ 0, 0, -2 ], [ 0, 1.3, -3 ] ) );
		expect( harness.control.follow ).toEqual( { npcId: 'npc.witness', mode: 'following' } );

		harness.control.actor.position = [ 3, 0, -2 ];
		harness.gameplay.transitEvent( board(), {
			timeMin: TIME, playerPlaces: [ { kind: 'stop', id: 'stop-a' } ], position: [ 3, 0, -2 ]
		} );
		expect( harness.continuity.carryFollower ).toHaveBeenCalled();

		expect( harness.gameplay.transitEvent( disembark( 'other' ), {
			timeMin: TIME, playerPlaces: [ P7 ], position: [ 10, 0, -2 ]
		} ) ).toBeNull();
		expect( harness.gameplay.transitEvent( disembark(), {
			timeMin: TIME, playerPlaces: [ { kind: 'stop', id: 'stop-b' } ], position: [ 7, 0, -2 ]
		} ) ).toBeNull();
		expect( harness.session.persistenceView()[ 0 ].completedSteps ).toEqual( [] );
		expect( harness.control.follow ).toEqual( { npcId: 'npc.witness', mode: 'following' } );

		harness.control.actor.position = [ 10, 0, -2 ];
		harness.gameplay.candidates( frame( P7, [ 10, 0, -2 ], [ 10, 1.3, -3 ] ) );
		expect( harness.gameplay.drainMechanicResults()[ 0 ] ).toMatchObject( {
			ok: true, eventKind: 'transported', progressed: true
		} );
		expect( harness.continuity.stopFollow ).toHaveBeenCalledWith( { timeMin: TIME } );

	} );

	it( 'restores exact approach, aboard and arrival stages without losing the passenger', () => {

		const source = setup( [ transportDefinition() ] );
		source.gameplay.candidates( frame( P4, [ 0, 0, -2 ], [ 0, 1.3, -3 ] ) );
		const approach = source.gameplay.serializeTransit();
		expect( approach ).toMatchObject( {
			questId: 'transport-only', stepId: 'transportation', stage: 'approach',
			tripId: null, routeId: null, passengerNpcId: 'npc.witness'
		} );
		const approachRestore = restored( approach, { position: { x: 0, y: 0, z: -2 } } );
		expect( approachRestore.gameplay.serializeTransit() ).toEqual( approach );

		source.control.actor.position = [ 3, 0, -2 ];
		source.gameplay.transitEvent( board(), { timeMin: TIME, playerPlaces: [], position: [ 3, 0, -2 ] } );
		const aboard = source.gameplay.serializeTransit();
		expect( aboard ).toMatchObject( { stage: 'aboard', tripId: 'trip-live', routeId: 'route-live' } );
		expect( restored( aboard, {
			position: { x: 3, y: 0, z: -2 }, place: { kind: 'route', id: 'route-live' },
			journey: { tripId: 'trip-live', routeId: 'route-live' }
		} ).ok ).toBe( true );

		source.gameplay.transitEvent( disembark(), { timeMin: TIME, playerPlaces: [], position: [ 7, 0, -2 ] } );
		const arrival = source.gameplay.serializeTransit();
		expect( arrival ).toMatchObject( { stage: 'arrival', tripId: 'trip-live', routeId: 'route-live' } );
		expect( restored( arrival, { position: { x: 7, y: 0, z: -2 }, at: [ 7, 0, -2 ] } ).gameplay.serializeTransit() )
			.toEqual( arrival );

	} );

	it( 'reconstructs a saved active ride from its exact authored stop and completes at its station', () => {

		const harness = setup( [ transportDefinition( { from: { stopId: 'stop-a' }, to: { stationId: 'station-b' } } ) ], {
			behaviorPlace: { kind: 'stop', id: 'stop-a' }
		} );
		harness.control.actor.place = { kind: 'route', id: 'route-live' };
		harness.control.actor.mode = 'following';
		harness.control.follow = { npcId: 'npc.witness', mode: 'following' };

		expect( harness.gameplay.restoreTransit( {
			timeMin: TIME, origin: { kind: 'stop', id: 'stop-a' }, position: { x: 0, y: 0, z: -2 },
			tripId: 'trip-live', routeId: 'route-live'
		} ) ).toBe( true );
		expect( harness.control.actors.map( ( value ) => value.npcId ) ).toEqual( [ 'npc.witness' ] );
		expect( harness.continuity.startFollow ).not.toHaveBeenCalled();
		expect( harness.gameplay.transitEvent( disembark(), {
			timeMin: TIME, playerPlaces: [ { kind: 'station', id: 'station-b' } ], position: [ 10, 0, -2 ]
		} ) ).toMatchObject( { ok: true, eventKind: 'transported', progressed: true } );

	} );

} );

function startEscort( harness ) {

	const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 1.3, -2 ] ) )[ 0 ];
	expect( harness.gameplay.perform( {
		targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
	} ) ).toBeNull();
	return candidate;

}

function rescue( harness ) {

	const candidate = harness.gameplay.candidates( frame( P4, [ 0, 0, 0 ], [ 0, 0.75, -2 ] ) )[ 0 ];
	return harness.gameplay.perform( {
		targetKey: candidate.interaction.targetKey, bindingAction: 'interact', timeMin: TIME
	} );

}

function restored( state, { position, place = null, journey = null, at = null } ) {

	const harness = setup( [ transportDefinition() ] );
	if ( place ) harness.control.actor.place = place;
	if ( at ) harness.control.actor.position = at;
	harness.control.actor.mode = 'following';
	harness.control.follow = { npcId: 'npc.witness', mode: 'following' };
	const ok = harness.gameplay.restoreTransitState( { timeMin: TIME, position, state, journey } );
	expect( ok ).toBe( true );
	return { gameplay: harness.gameplay, ok };

}

function board() {

	return { action: 'board', result: { ok: true, service: { tripId: 'trip-live', routeId: 'route-live' } } };

}

function disembark( tripId = 'trip-live' ) {

	return { action: 'disembark', result: { ok: true, tripId, routeId: 'route-live' } };

}

function impact( personId ) {

	return {
		personId, vehicleId: 'car.live', impactSpeed: 12, fatal: true,
		point: { x: 0, y: 1, z: 0 }, impulse: { x: 0, y: 9, z: 90 }
	};

}

function setup( definitions, options = {} ) {

	const people = new Map( [
		[ 'npc.witness', npc( 'npc.witness', 'witness', 'p4' ) ],
		[ 'npc.mark', npc( 'npc.mark', 'mark', 'p4' ) ]
	] );
	const sim = simulation( people, options );
	const session = QuestSession.create( definitions, sim, TIME );
	const control = { actor: actor(), actors: [], follow: null, phase: 'walking' };
	if ( ! options.initiallyEmpty ) control.actors.push( control.actor );
	const find = ( npcId ) => control.actors.find( ( value ) => value.npcId === npcId );
	const take = ( request, mode ) => {

		control.actor = find( request.npcId ) ?? actor( request.npcId );
		if ( ! control.actors.includes( control.actor ) ) control.actors.push( control.actor );
		control.actor.mode = mode;
		control.follow = { npcId: request.npcId, mode };
		return structuredClone( control.actor );

	};
	const continuity = {
		get companion() {

			return control.follow
				? { ...control.follow, phase: control.phase, position: [ ...find( control.follow.npcId ).position ] }
				: null;

		},
		actor: vi.fn( ( npcId ) => structuredClone( find( npcId ) ?? null ) ),
		startFollow: vi.fn( ( request ) => take( request, 'following' ) ),
		startLead: vi.fn( ( request ) => take( request, 'leading' ) ),
		carryFollower: vi.fn( ( request ) => {

			control.actor = control.actors.find( ( value ) => value.npcId === request.npcId );
			control.actor.position = [ ...request.position ];
			return structuredClone( control.actor );

		} ),
		stopFollow: vi.fn( () => {

			control.actor = find( control.follow?.npcId ) ?? control.actor;
			control.actor.mode = 'resuming';
			control.follow = null;
			return structuredClone( control.actor );

		} )
	};
	const crowd = {
		questMember: vi.fn( ( npcId ) => {

			let present = control.actors.find( ( value ) => value.npcId === npcId );
			if ( ! present ) {

				present = actor( npcId );
				control.actors.push( present );
				if ( npcId === 'npc.witness' ) control.actor = present;

			}
			return { id: `body:${npcId}`, npcId, position: new THREE.Vector3().fromArray( present.position ) };

		} ),
		syncActor: vi.fn( ( value ) => (
			{ id: `body:${value.npcId}`, npcId: value.npcId, position: new THREE.Vector3().fromArray( value.position ) }
		) )
	};
	const mechanics = new QuestMechanics( session );
	const gameplay = new QuestGameplay( {
		session, actions: new QuestActions( session ), mechanics,
		world: { parcels: [ { id: 'p4', anchor: [ 0, 0, -2 ] }, { id: 'p7', anchor: [ 10, 0, -2 ] } ] },
		crowd, continuity, missionItems: missionAssets(),
		physics: { rapier: null, world: null }, playerCollider: null,
		materialFactory: { build: () => new THREE.MeshStandardMaterial( { color: 0x223344 } ) }
	} );
	return { gameplay, session, continuity, control, people, crowd, mechanics };

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
	}, {
		wantedByRoleId: 'witness',
		gives: kind === 'hacking' ? [ 'entry-code' ] : [],
		needs: kind === 'access' ? [ 'entry-code' ] : [],
		next: [ { toStepId: index === kinds.length - 1 ? 'transportation' : kinds[ index + 1 ][ 0 ], when: [] } ]
	} ) );
	steps.push( step( 'transportation', transportationTarget( [ 'entry-code' ] ), {
		wantedByRoleId: 'witness', needs: [ 'entry-code' ], endingId: 'safe'
	} ) );
	return quest( 'fixed', {
		roles: [ role( 'witness', 'witness' ) ],
		items: [ { itemId: 'entry-code', name: 'Entry code', description: 'Archive credential device.', kind: 'device' } ],
		flags: [ ...kinds.map( ( [ kind ] ) => `${kind}-done` ), 'transport-done' ],
		steps, endingId: 'safe'
	} );

}

function transportDefinition( endpoints = {} ) {

	return quest( 'transport-only', {
		roles: [ role( 'witness', 'witness' ) ], flags: [ 'transport-done' ], endingId: 'safe',
		steps: [ step( 'transportation', transportationTarget( [], endpoints ), { wantedByRoleId: 'witness', endingId: 'safe' } ) ]
	} );

}

function rescueDefinition() {

	return quest( 'fixed', {
		roles: [ role( 'witness', 'witness' ) ], flags: [ 'rescue-done' ], endingId: 'safe',
		steps: [ step( 'rescue', {
			kind: 'rescue', roleId: 'witness', releaseTargetId: 'witness-release',
			place: { parcelId: 'p4' }, completionFlag: 'rescue-done'
		}, { endingId: 'safe' } ) ]
	} );

}

function escortDefinition( mode, to = { parcelId: 'p7' } ) {

	return quest( `escort-${mode}`, {
		roles: [ role( 'witness', 'witness' ) ], flags: [ 'escort-done' ], endingId: 'safe',
		steps: [ step( 'escort', {
			kind: 'escort', roleId: 'witness', routeId: 'safe-route', mode,
			from: { parcelId: 'p4' }, to, completionFlag: 'escort-done'
		}, { endingId: 'safe' } ) ]
	} );

}

function assassinationDefinition() {

	return quest( 'assassination', {
		roles: [ role( 'mark', 'mark' ) ], endingId: 'stopped',
		steps: [ step( 'assassinate', { kind: 'assassinate', roleId: 'mark' }, { endingId: 'stopped' } ) ]
	} );

}

function transportationTarget( cargoItemIds = [], endpoints = {} ) {

	return {
		kind: 'transportation', journeyId: 'archive-to-market', mode: 'public-transit',
		from: endpoints.from ?? { parcelId: 'p4' }, to: endpoints.to ?? { parcelId: 'p7' },
		passengerRoleIds: [ 'witness' ], cargoItemIds, completionFlag: 'transport-done'
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
		timeMin: TIME, playerPlaces: Array.isArray( place ) ? place : [ place ],
		feet: record( new THREE.Vector3().fromArray( feet ) ),
		eye: record( eye ), look: record( new THREE.Vector3().fromArray( focus ).sub( eye ).normalize() )
	};

}

function actor( npcId = 'npc.witness' ) {

	return { npcId, position: [ 0, 0, -2 ], animation: 'idle', mode: 'schedule' };

}

function record( vector ) {

	return { x: vector.x, y: vector.y, z: vector.z };

}
