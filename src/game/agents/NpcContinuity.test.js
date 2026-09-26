import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS, restoreSimulation } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { CLIP, clipForNpcAnimation } from './CharacterAssets.js';
import { NpcContinuity, selectNpcAnimation } from './NpcContinuity.js';
import { NpcContinuityError } from './NpcContinuityError.js';
import { WalkRoutes } from './WalkRoutes.js';
import { Crowd } from './Crowd.js';

const MON_9 = 9 * 60;

describe( 'NPC continuity integration', () => {

	it( 'keeps one named body through home, path3 commute, work, unload and reappearance', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const monday = npc.routine.filter( ( entry ) => entry.days.includes( 0 ) );
		const outbound = monday.find( ( entry ) => entry.walk?.to.id === 'p_cafe' );
		const work = monday.find( ( entry ) => entry.activity === 'working' && entry.place.id === 'p_cafe' );
		const inbound = monday.find( ( entry ) => entry.walk?.from.id === 'p_cafe' );

		const home = controller.appear( { npcId: npc.npcId, timeMin: outbound.startMin - 1 } );
		expect( home ).toMatchObject( {
			npcId: npc.npcId,
			appearanceSeed: npc.appearanceSeed,
			place: { kind: 'parcel', id: npc.home.parcelId },
			schedule: { nextDestination: { kind: 'parcel', id: 'p_cafe' } }
		} );

		const commute = controller.appear( { npcId: npc.npcId, timeMin: outbound.startMin + 0.5 } );
		expect( commute.place.kind ).toBe( 'edge' );
		expect( commute.position[ 1 ] ).toBeGreaterThan( 1 );
		expect( commute.animation ).toBe( 'walk' );

		const working = controller.appear( { npcId: npc.npcId, timeMin: work.startMin + 2 } );
		expect( working ).toMatchObject( {
			npcId: npc.npcId,
			place: { kind: 'parcel', id: 'p_cafe' },
			schedule: { nextDestination: { kind: 'parcel', id: npc.home.parcelId } }
		} );
		expect( controller.unload( { npcId: npc.npcId } ).visible ).toBe( false );
		expect( controller.serialize().actors[ 0 ].visible ).toBe( false );
		const reappeared = controller.appear( { npcId: npc.npcId, timeMin: inbound.startMin + 0.25 } );
		expect( reappeared.npcId ).toBe( npc.npcId );
		expect( reappeared.appearanceSeed ).toBe( home.appearanceSeed );
		expect( reappeared.gender ).toBe( home.gender );
		expect( reappeared.schedule.progress ).toBeCloseTo( 0.25 / ( inbound.endMin - inbound.startMin ) );

		// the same identity survives distance virtualization in both directions
		const [ far ] = controller.updateVisible( {
			timeMin: inbound.startMin + 0.5,
			playerPosition: [ reappeared.position[ 0 ] + 200, reappeared.position[ 1 ], reappeared.position[ 2 ] ],
			maxDistance: 100
		} );
		expect( far ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: home.appearanceSeed, visible: false
		} );
		const [ near ] = controller.updateVisible( {
			timeMin: inbound.startMin + 0.75, playerPosition: reappeared.position, maxDistance: 100
		} );
		expect( near ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: home.appearanceSeed, gender: home.gender, visible: true
		} );

	} );

	it( 'projects one named commuter over the authoritative transit path3 and restores it exactly', () => {

		const networks = transitNetwork();
		const first = setup( null, networks );
		const npc = first.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const monday = npc.routine.filter( ( entry ) => entry.days.includes( 0 ) );
		const ride = monday.find( ( entry ) => entry.transitLeg );
		const walk = monday.find( ( entry ) => entry.activity === 'commuting' && entry.walk && entry.startMin < ride.startMin );
		const work = monday.find( ( entry ) => entry.activity === 'working' && entry.place.id === 'p_cafe' );
		const route = networks.transit.routes.find( ( candidate ) => candidate.id === ride.transitLeg.routeId );

		const home = first.controller.appear( { npcId: npc.npcId, timeMin: walk.startMin - 1 } );
		const walking = first.controller.appear( { npcId: npc.npcId, timeMin: walk.startMin + 0.25 } );
		const aboardAt = ride.startMin + ( ride.endMin - ride.startMin ) * 0.25;
		const aboard = first.controller.appear( { npcId: npc.npcId, timeMin: aboardAt } );
		const later = first.controller.appear( {
			npcId: npc.npcId, timeMin: ride.startMin + ( ride.endMin - ride.startMin ) * 0.75
		} );

		expect( home ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: npc.appearanceSeed,
			place: { kind: 'parcel', id: npc.home.parcelId }
		} );
		expect( walking ).toMatchObject( { npcId: npc.npcId, place: { kind: 'edge' }, animation: 'walk' } );
		expect( aboard ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: home.appearanceSeed,
			name: home.name, gender: home.gender,
			place: { kind: 'route', id: route.id }, mode: 'schedule'
		} );
		expect( aboard.position[ 0 ] ).toBeCloseTo( 550 );
		expect( aboard.position[ 1 ] ).toBeCloseTo( 4 );
		expect( aboard.position[ 2 ] ).toBeCloseTo( 250 );
		expect( aboard.heading ).toBeCloseTo( - Math.PI / 2 );
		expect( later.position[ 0 ] ).toBeCloseTo( 450 );
		expect( later.position[ 1 ] ).toBeCloseTo( 4 );
		expect( later.position[ 2 ] ).toBeCloseTo( 250 );
		expect( separation( aboard.position, later.position ) ).toBeGreaterThan( 0 );
		expect( code( () => first.controller.startFollow( {
			npcId: npc.npcId, timeMin: aboardAt, playerPosition: [ 500, 1, 250 ]
		} ) ) ).toBe( 'E_NPC_PLACE' );

		first.controller.unload( { npcId: npc.npcId } );
		const continuitySave = first.controller.serialize();
		const simulationSave = first.bridge.simulation.serialize();
		const restoredSimulation = restoreSimulation( simulationInput( networks ), simulationSave );
		const restored = setup( restoredSimulation, networks );
		restored.controller.restore( continuitySave );
		const reappeared = restored.controller.appear( { npcId: npc.npcId, timeMin: aboardAt } );
		expect( reappeared ).toEqual( { ...aboard, visible: true } );

		const working = restored.controller.appear( { npcId: npc.npcId, timeMin: work.startMin + 1 } );
		expect( working ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: home.appearanceSeed,
			place: { kind: 'parcel', id: 'p_cafe' }, schedule: { entryIndex: npc.routine.indexOf( work ) }
		} );

	} );

	it( 'fails closed when a scheduled transit leg lacks authoritative path3 or timing facts', () => {

		for ( const missing of [ 'shape', 'timing' ] ) {

			const networks = transitNetwork();
			if ( missing === 'shape' ) delete networks.transit.routes[ 0 ].shape;
			else networks.transit.routes[ 0 ].template[ 3 ].depart = networks.transit.routes[ 0 ].template[ 4 ].arrive;
			const { bridge, controller } = setup( null, networks );
			const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
			const ride = npc.routine.find( ( entry ) => entry.days.includes( 0 ) && entry.transitLeg );
			expect( code( () => controller.appear( {
				npcId: npc.npcId, timeMin: ( ride.startMin + ride.endMin ) / 2
			} ) ) ).toBe( 'E_NPC_PLACE' );

		}

	} );

	it( 'follows by bounded walk paths, stops naturally, and walks back into the current routine', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const player = [ 560, 1, 250 ];
		let actor = controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: player } );
		const start = actor.position;
		actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition: player } );
		expect( separation( start, actor.position ) ).toBeLessThanOrEqual( 2.4 + 1e-9 );
		expect( actor.animation ).toBe( 'run' );

		for ( let step = 0; step < 300 && actor.animation !== 'idle'; step ++ ) {

			actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition: player } );

		}
		expect( separation( actor.position, player ) ).toBeGreaterThanOrEqual( 1.79 );
		expect( separation( actor.position, player ) ).toBeLessThan( 1.9 );
		expect( actor.animation ).toBe( 'idle' );

		const held = actor.position;
		actor = controller.stopFollow( { timeMin: MON_9 + 1 } );
		expect( actor.mode ).toBe( 'resuming' );
		expect( actor.position ).toEqual( held );
		expect( controller.companion ).toBeNull();
		let previous = actor.position;
		for ( let step = 0; step < 300 && actor.mode === 'resuming'; step ++ ) {

			actor = walkOn( controller, npc.npcId, { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: player } );
			expect( separation( previous, actor.position ) ).toBeLessThanOrEqual( 1.4 + 1e-9 );
			previous = actor.position;

		}
		expect( actor ).toMatchObject( { npcId: npc.npcId, mode: 'schedule', place: { kind: 'parcel', id: 'p_cafe' } } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( false );

	} );

	it( 'serializes the exact identity and interruption while following', () => {

		const first = setup();
		const npc = first.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		first.controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		first.controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition: [ 560, 1, 250 ] } );
		const saved = first.controller.serialize();
		const simSave = first.bridge.simulation.serialize();
		const next = setup( restoreSimulation( simulationInput(), simSave ) );

		expect( next.controller.restore( saved ) ).toEqual( saved );
		expect( next.bridge.behaviorAt( npc.npcId, MON_9 + 2 ).interrupted ).toBe( true );
		expect( next.bridge.serialize() ).toEqual( simSave );
		expect( next.controller.appear( { npcId: npc.npcId, timeMin: MON_9 + 2 } ) ).toEqual( saved.actors[ 0 ] );

	} );

	it( 'attaches an exact follower to a measured transit route', () => {

		const riding = setup();
		const rider = riding.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		riding.controller.startFollow( { npcId: rider.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		expect( riding.controller.carryFollower( {
			npcId: rider.npcId, position: [ 700, 4, 250 ], routeId: 'route-live'
		} ) ).toMatchObject( {
			npcId: rider.npcId, position: [ 700, 4, 250 ], place: { kind: 'route', id: 'route-live' },
			mode: 'following', animation: 'idle'
		} );
		expect( code( () => riding.controller.carryFollower( {
			npcId: 'other', position: [ 700, 4, 250 ], routeId: 'route-live'
		} ) ) ).toBe( 'E_NPC_CONFLICT' );

	} );

	it( 'holds explicit crouch through visibility and save restore, then walks back to the routine', () => {

		const first = setup();
		const npc = first.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const commute = npc.routine.find( ( entry ) => entry.days.includes( 0 ) && entry.walk?.to.id === 'p_cafe' );
		const startedAt = commute.startMin + 0.5;
		const crouched = first.controller.startCrouch( { npcId: npc.npcId, timeMin: startedAt } );

		expect( crouched ).toMatchObject( {
			npcId: npc.npcId, mode: 'posing', animation: 'crouch', visible: true
		} );
		expect( code( () => first.controller.startCrouch( { npcId: npc.npcId } ) ) ).toBe( 'E_NPC_INPUT' );
		expect( first.bridge.behaviorAt( npc.npcId, startedAt ).interrupted ).toBe( true );
		expect( first.controller.updateVisible( {
			timeMin: startedAt + 1, playerPosition: [ 10000, 0, 10000 ], maxDistance: 5
		} )[ 0 ] ).toEqual( crouched );
		expect( code( () => first.controller.startFollow( {
			npcId: npc.npcId, timeMin: startedAt, playerPosition: [ 560, 1, 250 ]
		} ) ) ).toBe( 'E_NPC_CONFLICT' );

		const saved = first.controller.serialize();
		const restored = setup( restoreSimulation( simulationInput(), first.bridge.simulation.serialize() ) );
		expect( restored.controller.restore( saved ) ).toEqual( saved );
		expect( saved.pose ).toEqual( { npcId: npc.npcId, kind: 'crouch', lastTimeMin: startedAt } );

		let returning = restored.controller.releaseCrouch( { npcId: npc.npcId, timeMin: startedAt + 1 } );
		expect( restored.controller.serialize().pose ).toBeNull();
		expect( restored.bridge.behaviorAt( npc.npcId, startedAt + 1 ).interrupted ).toBe( false );
		for ( let step = 0; step < 300 && returning.mode === 'resuming'; step ++ ) {

			returning = walkOn( restored.controller, npc.npcId, {
				timeMin: startedAt + 1, deltaSeconds: 1, playerPosition: [ 560, 1, 250 ]
			} );

		}
		expect( returning ).toMatchObject( { npcId: npc.npcId, mode: 'schedule', animation: 'walk' } );
		expect( code( () => restored.controller.releaseCrouch( {
			npcId: npc.npcId, timeMin: startedAt + 2
		} ) ) ).toBe( 'E_NPC_CONFLICT' );

	} );

	it.each( [ false, true ] )( 'returns a stationary %s seated person to the same post after closing, reopening and restoring', ( seated ) => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const position = [ 561, 1, 251 ], place = { kind: 'parcel', id: 'p_cafe' };
		const post = { heading: 0.75, spot: seated ? 'seat:0' : 'work:0' };
		const request = { npcId: npc.npcId, timeMin: MON_9, position, place, heading: 2, seated, post };
		const expected = { position, place, heading: post.heading, spot: post.spot, mode: 'schedule', animation: seated ? 'sit' : 'idle' };
		const schedule = bridge.continuityAt( npc.npcId, MON_9 ).schedule;
		for ( let opening = 0; opening < 3; opening ++ ) {

			controller.beginConversation( request );
			expect( controller.endConversation( { timeMin: MON_9 + 1 } ) ).toMatchObject( expected );
			expect( controller.serialize().follow ).toBeNull();
			expect( controller.heldNpcIds ).toEqual( [] );
			expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( false );
			for ( let second = 0; second < 61; second ++ ) {

				expect( controller.updateVisible( { timeMin: MON_9 + 1 + second / 60, playerPosition: position, maxDistance: 45 } )[ 0 ] )
					.toMatchObject( { ...expected, visible: true } );

			}

		}
		// A conversation saved before closing and an ordinary saved post both restore.
		controller.beginConversation( request );
		const restored = setup( restoreSimulation( simulationInput(), bridge.simulation.serialize() ) );
		restored.controller.restore( controller.serialize() );
		expect( restored.controller.endConversation( { timeMin: MON_9 + 2 } ) ).toMatchObject( expected );
		const afterClose = setup( restoreSimulation( simulationInput(), restored.bridge.simulation.serialize() ) );
		afterClose.controller.restore( restored.controller.serialize() );
		expect( afterClose.controller.appear( { npcId: npc.npcId, timeMin: MON_9 + 3 } ) ).toMatchObject( expected );
		// A new schedule occurrence must release the post, including a later week
		// with the same entry index and parcel.
		const nextWeek = afterClose.controller.appear( { npcId: npc.npcId, timeMin: MON_9 + 7 * 1440 } );
		expect( nextWeek.schedule.startMin ).not.toBe( schedule.startMin );
		expect( nextWeek.position ).not.toEqual( position );
		expect( afterClose.controller.serialize().posts ).toBeUndefined();
		const shifted = restored.controller.appear( { npcId: npc.npcId, timeMin: schedule.endMin } );
		expect( shifted.position ).not.toEqual( position );
		expect( restored.controller.serialize().posts ).toBeUndefined();

	} );

	it( 'closing a worker conversation leaves another NPC follower under its original control', () => {

		const { bridge, controller } = setup();
		const worker = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const follower = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } );
		controller.hold( { npcId: follower.npcId, timeMin: MON_9, position: [ 500, 3, 250 ], heading: 0,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: false } );
		controller.startFollow( { npcId: follower.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		const follow = controller.serialize().follow;
		controller.beginConversation( { npcId: worker.npcId, timeMin: MON_9, position: [ 561, 1, 251 ], heading: 2,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: false, post: { heading: 0, spot: 'work:0' } } );
		expect( controller.endConversation( { timeMin: MON_9 + 1 } ).mode ).toBe( 'schedule' );
		expect( controller.serialize().follow ).toEqual( follow );

	} );

	it( 'closes a legacy saved indoor conversation without losing the person when no return route exists', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const position = [ 561, 1, 251 ];
		controller.beginConversation( { npcId: npc.npcId, timeMin: MON_9, position, heading: 1.2,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: true } );
		const restored = setup( restoreSimulation( simulationInput(), bridge.simulation.serialize() ) );
		restored.controller.restore( controller.serialize() );
		restored.controller.routes.route = () => null;
		expect( restored.controller.endConversation( { timeMin: MON_9 + 1 } ) ).toMatchObject( {
			position, heading: 1.2, mode: 'schedule', animation: 'sit', visible: true
		} );
		expect( restored.controller.serialize().conversation ).toBeNull();
		expect( restored.controller.serialize().follow ).toBeNull();
		expect( restored.bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( false );
		expect( restored.controller.updateVisible( { timeMin: MON_9 + 2, playerPosition: position, maxDistance: 45 } )[ 0 ] )
			.toMatchObject( { position, visible: true, animation: 'sit', mode: 'schedule' } );

	} );

	it( 'owns conversation interruption and walks back without moving the visible body on close', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const visible = [ 560, 1, 250 ];
		const talking = controller.beginConversation( {
			npcId: npc.npcId, timeMin: MON_9, position: visible, heading: 0,
			place: { kind: 'edge', id: 'walk-p_cafe' }, seated: false
		} );
		expect( talking ).toMatchObject( { npcId: npc.npcId, position: visible, mode: 'conversation', animation: 'idle' } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( true );

		let returning = controller.endConversation( { timeMin: MON_9 + 1 } );
		expect( returning.position ).toEqual( visible );
		expect( returning.mode ).toBe( 'resuming' );
		for ( let step = 0; step < 300 && returning.mode === 'resuming'; step ++ ) {

			returning = walkOn( controller, npc.npcId, { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: visible } );

		}
		expect( returning ).toMatchObject( { npcId: npc.npcId, mode: 'schedule', place: { kind: 'parcel', id: 'p_cafe' } } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( false );

		// a follower keeps its interruption and returns to follow control
		const escort = setup();
		const walker = escort.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const following = escort.controller.startFollow( {
			npcId: walker.npcId, timeMin: MON_9, playerPosition: visible
		} );
		escort.controller.beginConversation( {
			npcId: walker.npcId, timeMin: MON_9, position: following.position, heading: following.heading,
			place: following.place, seated: false
		} );
		expect( escort.controller.updateFollow( {
			timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: visible
		} ).mode ).toBe( 'conversation' );
		expect( escort.controller.endConversation( { timeMin: MON_9 + 1 } ).mode ).toBe( 'following' );
		expect( escort.bridge.behaviorAt( walker.npcId, MON_9 + 2 ).interrupted ).toBe( true );

	} );

	it.each( [ false, true ] )( 'pins a %s seated appointment at 21:00 across a schedule boundary, reopen and streaming', ( seated ) => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const place = { kind: 'parcel', id: 'p_cafe' };
		const position = [ 561, 1, 251 ];
		const request = { npcId: npc.npcId, timeMin: 1260, position, heading: 0.5, place, seated };
		expect( bridge.behaviorAt( npc.npcId, 1260 ).place.id ).not.toBe( place.id );
		controller.hold( request );
		for ( let opening = 0; opening < 2; opening ++ ) {

			controller.beginConversation( request );
			for ( let second = 0; second <= 60; second ++ ) {

				const timeMin = 1260 + second * 3;
				controller.updateFollow( { timeMin, deltaSeconds: 1, playerPosition: [ 10000, 1, 10000 ] } );
				const [ actor ] = controller.updateVisible( { timeMin, playerPosition: [ 10000, 1, 10000 ], maxDistance: 45 } );
				expect( actor ).toMatchObject( { npcId: npc.npcId, position, heading: 0.5, place,
					mode: 'conversation', animation: seated ? 'sit' : 'idle', visible: true } );
				expect( controller.appear( { npcId: npc.npcId, timeMin } ) ).toEqual( actor );
				expect( code( () => controller.hold( { ...request, position: [ 999, 1, 999 ] } ) ) ).toBe( 'E_NPC_CONFLICT' );
				expect( code( () => controller.releaseHold( { npcId: npc.npcId, timeMin } ) ) ).toBe( 'E_NPC_CONFLICT' );

			}
			expect( controller.endConversation( { timeMin: 1440, hold: true } ) ).toMatchObject( {
				position, heading: 0.5, place, mode: 'posing', animation: seated ? 'sit' : 'idle'
			} );

		}
		const save = controller.serialize();
		const restored = setup( restoreSimulation( simulationInput(), bridge.simulation.serialize() ) ).controller;
		restored.restore( save );
		expect( restored.appear( { npcId: npc.npcId, timeMin: 1441 } ) ).toMatchObject( {
			position, heading: 0.5, place, mode: 'posing', animation: seated ? 'sit' : 'idle'
		} );

	} );

	it.each( [ false, true ] )( 'can close an autosaved conversation after restore with current quest hold %s', ( hold ) => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const position = [ 561, 1, 251 ];
		controller.hold( { npcId: npc.npcId, timeMin: 1260, position, heading: 0.5,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: true } );
		controller.beginConversation( { npcId: npc.npcId, timeMin: 1260, position, heading: 0.5,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: true } );
		const save = controller.serialize();
		const restored = setup( restoreSimulation( simulationInput(), bridge.simulation.serialize() ) );
		restored.controller.restore( save );
		const closed = restored.controller.endConversation( { timeMin: 1261, hold } );
		expect( restored.controller.serialize().conversation ).toBeNull();
		expect( closed.position ).toEqual( position );
		expect( closed.mode ).toBe( hold ? 'posing' : 'resuming' );
		expect( restored.controller.heldNpcIds ).toEqual( hold ? [ npc.npcId ] : [] );
		expect( restored.bridge.behaviorAt( npc.npcId, 1261 ).interrupted ).toBe( hold );

	} );

	it( 'keeps a seated follower fixed when transit and movement update during dialogue', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const actor = controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		const talking = controller.beginConversation( { npcId: npc.npcId, timeMin: MON_9, position: actor.position,
			heading: actor.heading, place: actor.place, seated: true } );
		expect( controller.carryFollower( { npcId: npc.npcId, routeId: 'bus', position: [ 900, 1, 900 ] } ) ).toEqual( talking );
		expect( controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: [ 900, 1, 900 ] } ) ).toEqual( talking );
		expect( controller.endConversation( { timeMin: MON_9 + 1 } ).mode ).toBe( 'following' );

	} );

	it( 'holds a quest cast where it is put, through a conversation and a save, until it is released', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const counter = [ 561, 1, 251 ];

		const posted = controller.hold( {
			npcId: npc.npcId, timeMin: MON_9, place: { kind: 'parcel', id: 'p_cafe' },
			position: counter, heading: 0.5
		} );
		expect( posted ).toMatchObject( { npcId: npc.npcId, position: counter, mode: 'posing', animation: 'idle' } );
		expect( controller.heldNpcIds ).toEqual( [ npc.npcId ] );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( true );

		// The schedule pass leaves a held body where the story put it.
		const [ standing ] = controller.updateVisible( {
			timeMin: MON_9 + 30, playerPosition: counter, maxDistance: 100
		} );
		expect( standing.position ).toEqual( counter );
		expect( standing.visible ).toBe( true );

		// Talking to them and walking away leaves them at the same spot.
		controller.beginConversation( {
			npcId: npc.npcId, timeMin: MON_9 + 31, position: counter, heading: 0.5,
			place: { kind: 'parcel', id: 'p_cafe' }, seated: false
		} );
		expect( controller.heldNpcIds ).toEqual( [] );
		expect( controller.endConversation( { timeMin: MON_9 + 32, hold: true } ) ).toMatchObject( {
			position: counter, mode: 'posing'
		} );
		const save = controller.serialize();
		expect( save.holds ).toEqual( [ { npcId: npc.npcId, lastTimeMin: MON_9 + 32 } ] );

		const restored = setup( restoreSimulation( simulationInput(), bridge.simulation.serialize() ) ).controller;
		expect( restored.restore( save ).holds ).toEqual( save.holds );
		expect( restored.updateVisible( {
			timeMin: MON_9 + 40, playerPosition: counter, maxDistance: 100
		} )[ 0 ].position ).toEqual( counter );

		// Released, they walk out of the spot and back into their own day.
		let returning = controller.releaseHold( { npcId: npc.npcId, timeMin: MON_9 + 33 } );
		expect( controller.heldNpcIds ).toEqual( [] );
		expect( returning.mode ).toBe( 'resuming' );
		for ( let step = 0; step < 300 && returning.mode === 'resuming'; step ++ ) {

			returning = walkOn( controller, npc.npcId, { timeMin: MON_9 + 33, deltaSeconds: 1, playerPosition: counter } );

		}
		expect( returning ).toMatchObject( { npcId: npc.npcId, mode: 'schedule' } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 34 ).interrupted ).toBe( false );

	} );

	it( 'preserves a seated quest body and reclaims its routine return without taking over an active escort', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const request = {
			npcId: npc.npcId, timeMin: MON_9, place: { kind: 'parcel', id: 'p_cafe' },
			position: [ 561, 1, 251 ], heading: Math.PI / 2, seated: true
		};
		const player = new Vector3( ...request.position );
		const crowd = new Crowd( {
			assets: null, sim: bridge, continuity: controller, routes: new WalkRoutes( network() ), signals: null,
			places: new Map( [ [ 'p_cafe', { inside: player.clone(), heading: 0, anchors: {} } ] ] ), capacity: 8
		} );
		const visible = crowd.syncActor( {
			...controller.appear( { npcId: npc.npcId, timeMin: MON_9 } ),
			position: request.position, place: request.place, heading: request.heading, animation: 'sit'
		}, player );
		const adopted = crowd.castMember( npc.npcId, MON_9, player, 'p_cafe' );
		expect( adopted ).toBe( visible );
		expect( adopted ).toMatchObject( { heading: request.heading, controlMode: 'posing', clip: CLIP.SIT } );
		expect( adopted.position.toArray() ).toEqual( request.position );
		expect( controller.updateVisible( {
			timeMin: MON_9 + 1, playerPosition: request.position, maxDistance: 100
		} )[ 0 ] ).toMatchObject( { animation: 'sit', position: request.position } );
		expect( controller.releaseHold( { npcId: npc.npcId, timeMin: MON_9 + 2 } ).mode ).toBe( 'resuming' );
		const next = { ...request, timeMin: MON_9 + 3, position: [ 562, 1, 252 ] };
		expect( controller.hold( next ) ).toMatchObject( { animation: 'sit', mode: 'posing', position: next.position } );
		expect( controller.serialize().follow ).toBeNull();
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 4 ).interrupted ).toBe( true );

		for ( const mode of [ 'following', 'leading' ] ) {

			const escort = setup();
			const person = escort.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
			if ( mode === 'following' ) escort.controller.startFollow( {
				npcId: person.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ]
			} );
			else escort.controller.startLead( {
				npcId: person.npcId, timeMin: MON_9,
				destination: { kind: 'parcel', id: FIXTURE_BLUEPRINT.parcels.find( ( parcel ) => parcel.id !== 'p_cafe' ).id }
			} );
			const before = escort.controller.serialize();
			expect( code( () => escort.controller.hold( { ...request, npcId: person.npcId } ) ) ).toBe( 'E_NPC_CONFLICT' );
			expect( escort.controller.serialize() ).toEqual( before );

		}

	} );

	it.each( [ 'following', 'leading' ] )( 'talking to a bystander never drops the active %s companion', ( mode ) => {

		const { bridge, controller } = setup();
		const companion = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const bystander = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } );
		const player = [ 560, 1, 250 ];
		startCompanion( controller, mode, companion.npcId, player );
		controller.beginConversation( { npcId: bystander.npcId, timeMin: MON_9, position: [ 505, 3, 250 ], heading: 0,
			place: { kind: 'edge', id: 'walk-p_clinic' }, seated: false } );
		expect( controller.endConversation( { timeMin: MON_9 + 1 } ).mode ).toBe( 'resuming' );
		expect( controller.companion ).toMatchObject( { npcId: companion.npcId, mode } );
		expect( walkingHome( controller ) ).toEqual( [ bystander.npcId ] );
		for ( let step = 0; step < 300 && walkingHome( controller ).length; step ++ ) {

			controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: player } );
			expect( controller.companion ).toMatchObject( { npcId: companion.npcId, mode } );

		}
		expect( controller.actor( bystander.npcId ) ).toMatchObject( { mode: 'schedule' } );
		expect( controller.actor( companion.npcId ).mode ).toBe( mode );
		expect( bridge.behaviorAt( companion.npcId, MON_9 + 2 ).interrupted ).toBe( true );
		expect( bridge.behaviorAt( bystander.npcId, MON_9 + 2 ).interrupted ).toBe( false );
		expect( controller.serialize().follow ).toMatchObject( { npcId: companion.npcId, mode } );

	} );

	it( 'lets a new companion start while someone walks home, and finishes a walk home out of sight', () => {

		const { bridge, controller } = setup();
		const walker = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } );
		const guide = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		controller.beginConversation( { npcId: walker.npcId, timeMin: MON_9, position: [ 505, 3, 250 ], heading: 0,
			place: { kind: 'edge', id: 'walk-p_clinic' }, seated: false } );
		controller.endConversation( { timeMin: MON_9 + 1 } );
		expect( walkingHome( controller ) ).toEqual( [ walker.npcId ] );
		expect( controller.startLead( { npcId: guide.npcId, timeMin: MON_9 + 1, destination: { kind: 'parcel', id: 'p_clinic' } } ).mode )
			.toBe( 'leading' );

		// A walk home is not held in view: beyond the visible distance the schedule takes the body back.
		const far = [ 5000, 1, 5000 ];
		const states = controller.updateVisible( { timeMin: MON_9 + 1, playerPosition: far, maxDistance: 45 } );
		expect( states.find( ( actor ) => actor.npcId === walker.npcId ) ).toMatchObject( { mode: 'schedule', visible: false } );
		expect( states.find( ( actor ) => actor.npcId === guide.npcId ) ).toMatchObject( { mode: 'leading', visible: true } );
		expect( walkingHome( controller ) ).toEqual( [] );
		expect( controller.serialize().returns ).toEqual( [] );

	} );

	it( 'paces a lead: waits for a lagging player, walks on when they catch up and arrives once', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const destination = { kind: 'parcel', id: 'p_clinic' };
		let actor = controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination } );
		const start = actor.position;
		const events = [];
		const step = ( playerPosition ) => {

			actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition } );
			events.push( ...controller.drainEvents() );
			return actor;

		};
		for ( let index = 0; index < 60 && controller.companion.phase !== 'waiting'; index ++ ) step( start );
		expect( controller.companion.phase ).toBe( 'waiting' );
		expect( actor.animation ).toBe( 'idle' );
		const gap = separation( actor.position, start );
		expect( gap ).toBeGreaterThan( 10 );
		expect( gap ).toBeLessThan( 11 );
		expect( actor.heading ).toBeCloseTo( Math.atan2( start[ 0 ] - actor.position[ 0 ], start[ 2 ] - actor.position[ 2 ] ) );
		expect( step( start ).position ).toEqual( actor.position );

		// The player comes within reach: the leader walks on, at full pace while they keep up.
		step( actor.position );
		expect( controller.companion.phase ).toBe( 'walking' );
		expect( actor.animation ).toBe( 'walk' );
		for ( let index = 0; index < 1000 && controller.companion.phase !== 'arrived'; index ++ ) step( actor.position );
		expect( actor ).toMatchObject( { mode: 'leading', animation: 'idle', place: destination } );
		for ( let index = 0; index < 5; index ++ ) step( actor.position );
		expect( events.map( ( event ) => event.phase ) ).toEqual( [ 'waiting', 'walking', 'arrived' ] );
		expect( events.at( - 1 ) ).toEqual( { npcId: npc.npcId, mode: 'leading', phase: 'arrived', timeMin: MON_9 } );
		expect( controller.serialize().follow ).toMatchObject( { mode: 'leading', phase: 'arrived', destination } );
		expect( controller.stopFollow( { timeMin: MON_9 + 1 } ).mode ).toBe( 'resuming' );

	} );

	it( 'keeps leading, and hurries, while the player is ahead on its path', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const target = FIXTURE_BLUEPRINT.parcels.find( ( parcel ) => parcel.id === 'p_clinic' ).access.point;
		const ahead = [ target[ 0 ], 1, target[ 1 ] ];
		let actor = controller.startLead( { npcId: npc.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' } } );
		actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition: ahead } );
		expect( actor.animation ).toBe( 'run' );
		const phases = [];
		for ( let index = 0; index < 600 && controller.companion.phase !== 'arrived'; index ++ ) {

			controller.updateFollow( { timeMin: MON_9, deltaSeconds: 1, playerPosition: ahead } );
			phases.push( ...controller.drainEvents().map( ( event ) => event.phase ) );

		}
		expect( phases ).toEqual( [ 'arrived' ] );

	} );

	it.each( [ 'following', 'leading' ] )( 'a %s companion given a pace gives up on a player who stays too far away', ( mode ) => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const pace = { giveUpBeyond: 20, giveUpAfterMin: 2 };
		startCompanion( controller, mode, npc.npcId, [ 560, 1, 250 ], pace );
		const far = [ 5000, 1, 5000 ];
		for ( const timeMin of [ MON_9, MON_9 + 1, MON_9 + 1.5 ] ) {

			controller.updateFollow( { timeMin, deltaSeconds: 0, playerPosition: far } );
			expect( controller.companion ).toMatchObject( { npcId: npc.npcId, mode } );

		}
		// Coming back in range restarts the clock.
		controller.updateFollow( { timeMin: MON_9 + 1.6, deltaSeconds: 0, playerPosition: controller.companion.position } );
		expect( controller.serialize().follow.lostSinceMin ).toBeUndefined();
		controller.updateFollow( { timeMin: MON_9 + 2, deltaSeconds: 0, playerPosition: far } );
		controller.updateFollow( { timeMin: MON_9 + 3.9, deltaSeconds: 0, playerPosition: far } );
		expect( controller.companion ).not.toBeNull();
		const actor = controller.updateFollow( { timeMin: MON_9 + 4, deltaSeconds: 0, playerPosition: far } );
		expect( controller.drainEvents().at( - 1 ) ).toEqual( {
			npcId: npc.npcId, mode, phase: 'gave-up', timeMin: MON_9 + 4, reason: 'player-lost'
		} );
		expect( controller.companion ).toBeNull();
		expect( [ 'resuming', 'schedule' ] ).toContain( actor.mode );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 4 ).interrupted ).toBe( false );

	} );

	it( 'a follower without a pace keeps following however far the player goes', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		for ( let minute = 0; minute < 60; minute += 5 ) {

			controller.updateFollow( { timeMin: MON_9 + minute, deltaSeconds: 0, playerPosition: [ 5000, 1, 5000 ] } );

		}
		expect( controller.companion ).toMatchObject( { npcId: npc.npcId, mode: 'following' } );

	} );

	it.each( [ 'following', 'leading' ] )( 'starts %s from the body on screen, not a later schedule projection', ( mode ) => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const commute = npc.routine.find( ( entry ) => entry.days.includes( 0 ) && entry.walk?.to.id === 'p_cafe' );
		const seen = controller.appear( { npcId: npc.npcId, timeMin: commute.startMin + 0.25 } );
		const later = commute.startMin + 1;
		const other = setup();
		other.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const projected = other.controller.appear( { npcId: npc.npcId, timeMin: later } );
		expect( separation( seen.position, projected.position ) ).toBeGreaterThan( 1 );
		const started = startCompanion( controller, mode, npc.npcId, [ 560, 1, 250 ], null, later );
		expect( started.position ).toEqual( seen.position );

	} );

	it( 'plans a route once and plans again only when its target moves', () => {

		const { bridge, controller } = setup();
		const plan = vi.spyOn( controller.routes, 'route' );
		const guide = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		let actor = controller.startLead( { npcId: guide.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' } } );
		for ( let index = 0; index < 40; index ++ ) {

			actor = controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: actor.position } );

		}
		expect( plan ).toHaveBeenCalledTimes( 1 );
		controller.stopFollow( { timeMin: MON_9 + 1 } );

		const follow = setup();
		const walker = follow.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const routes = vi.spyOn( follow.controller.routes, 'route' );
		const player = [ 560, 1, 250 ];
		follow.controller.startFollow( { npcId: walker.npcId, timeMin: MON_9, playerPosition: player } );
		for ( const offset of [ 0, 0.5, 0.9, 0.4 ] ) {

			follow.controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ player[ 0 ] + offset, 1, 250 ] } );

		}
		expect( routes ).toHaveBeenCalledTimes( 1 );
		follow.controller.updateFollow( { timeMin: MON_9, deltaSeconds: 0.5, playerPosition: [ player[ 0 ] + 3, 1, 250 ] } );
		expect( routes ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'restores a version 1 save: its walk home becomes a return and its leader keeps its route', () => {

		const returning = setup();
		const walker = returning.bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } );
		returning.controller.beginConversation( { npcId: walker.npcId, timeMin: MON_9, position: [ 505, 3, 250 ], heading: 0,
			place: { kind: 'edge', id: 'walk-p_clinic' }, seated: false } );
		returning.controller.endConversation( { timeMin: MON_9 + 1 } );
		const current = returning.controller.serialize();
		const legacy = legacySave( current, { ...current.returns[ 0 ], mode: 'resuming', source: 'conversation', lastTimeMin: MON_9 + 1 } );
		const restored = setup( restoreSimulation( simulationInput(), returning.bridge.simulation.serialize() ) ).controller;
		expect( restored.restore( legacy ) ).toEqual( current );
		expect( walkingHome( restored ) ).toEqual( [ walker.npcId ] );

		const leading = setup();
		const guide = leading.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		leading.controller.startLead( { npcId: guide.npcId, timeMin: MON_9, destination: { kind: 'parcel', id: 'p_clinic' } } );
		const { route, lastTimeMin } = leading.controller.serialize().follow;
		const old = legacySave( leading.controller.serialize(), { npcId: guide.npcId, mode: 'leading', route, lastTimeMin } );
		const upgraded = setup( restoreSimulation( simulationInput(), leading.bridge.simulation.serialize() ) ).controller;
		expect( upgraded.restore( old ).follow ).toEqual( {
			npcId: guide.npcId, mode: 'leading', phase: 'walking', route, lastTimeMin, pace: { giveUpBeyond: 60, giveUpAfterMin: 3 }
		} );
		expect( upgraded.companion ).toMatchObject( { npcId: guide.npcId, mode: 'leading', phase: 'walking' } );

	} );

	it( 'fails closed on unknown, placeless, unavailable and malformed identities', () => {

		const { bridge, controller } = setup();
		expect( code( () => controller.startFollow( { npcId: 'missing', timeMin: MON_9, playerPosition: [ 0, 0, 0 ] } ) ) ).toBe( 'E_NPC_UNKNOWN' );

		const driver = bridge.getNPCVendor( { role: 'driver', timeMin: MON_9 } );
		expect( code( () => controller.startFollow( { npcId: driver.npcId, timeMin: MON_9, playerPosition: [ 0, 0, 0 ] } ) ) ).toBe( 'E_NPC_PLACE' );

		const worker = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		expect( code( () => controller.startFollow( { npcId: worker.npcId, timeMin: MON_9 } ) ) ).toBe( 'E_NPC_INPUT' );
		const actor = controller.appear( { npcId: worker.npcId, timeMin: MON_9 } );
		const invalid = controller.serialize();
		invalid.actors[ 0 ] = { ...actor, appearanceSeed: ( actor.appearanceSeed + 1 ) >>> 0 };
		expect( code( () => controller.restore( invalid ) ) ).toBe( 'E_NPC_INPUT' );

		controller.startFollow( { npcId: worker.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		bridge.applyFlag( worker.npcId, { kind: 'die' } );
		const released = controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: [ 560, 1, 250 ] } );
		expect( released.mode ).toBe( 'released' );
		expect( controller.serialize().follow ).toBeNull();
		expect( controller.drainEvents() ).toEqual( [ {
			npcId: worker.npcId, mode: 'following', phase: 'gave-up', timeMin: MON_9 + 1, reason: 'unavailable'
		} ] );

	} );

} );

describe( 'NPC animation state', () => {

	it( 'maps locomotion and seating to purchased clips without inventing crouch', () => {

		expect( selectNpcAnimation( { speed: 0 } ) ).toBe( 'idle' );
		expect( selectNpcAnimation( { speed: 1.4 } ) ).toBe( 'walk' );
		expect( selectNpcAnimation( { speed: 2.4 } ) ).toBe( 'run' );
		expect( selectNpcAnimation( { seated: true } ) ).toBe( 'sit' );
		expect( selectNpcAnimation() ).not.toBe( 'crouch' );
		expect( selectNpcAnimation( { action: 'crouch' } ) ).toBe( 'crouch' );
		expect( [ 'walk', 'run', 'idle', 'sit', 'crouch' ].map( clipForNpcAnimation ) ).toEqual( [
			CLIP.WALK, CLIP.RUN, CLIP.IDLE, CLIP.SIT, CLIP.CROUCH
		] );

	} );

} );

function setup( simulation = null, networks = network() ) {

	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = simulation ? new SimBridge( simulation ) : SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const routes = new WalkRoutes( networks );
	const cafe = FIXTURE_INTERIORS.p_cafe;
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id,
		position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ],
		heading: 0,
		anchors: parcel.id === 'p_cafe' ? cafe.anchors.map( ( anchor ) => ( {
			id: anchor.id,
			position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ],
			heading: anchor.facingDeg * Math.PI / 180
		} ) ) : []
	} ) );
	return { bridge, controller: new NpcContinuity( { simulation: bridge, routes, places } ) };

}

function simulationInput( networks = network() ) {

	return {
		seed: FIXTURE_BLUEPRINT.meta.seed,
		blueprint: FIXTURE_BLUEPRINT,
		networks,
		interiors: FIXTURE_INTERIORS
	};

}

function transitNetwork() {

	const networks = network();
	const hub = networks.walk.nodes.find( ( node ) => node.id === 'hub' );
	for ( const stop of [
		...FIXTURE_BLUEPRINT.transit.busStops,
		...FIXTURE_BLUEPRINT.transit.trainStations,
		...FIXTURE_BLUEPRINT.transit.subwayStations
	] ) {

		const id = `stop-${stop.id}`;
		const [ x, z ] = stop.position;
		networks.walk.nodes.push( { id, x, y: 0, z, kind: 'stop', ref: stop.id } );
		networks.walk.edges.push( {
			id: `walk-stop-${stop.id}`, from: hub.id, to: id, kind: 'sidewalk', width: 2,
			path: [ [ hub.x, hub.z ], [ x, z ] ], path3: [ [ hub.x, hub.y, hub.z ], [ x, 0, z ] ]
		} );

	}
	const shape = [
		[ 400, 0, 250 ], [ 500, 8, 250 ], [ 600, 0, 250 ], [ 750, 6, 250 ], [ 900, 0, 250 ],
		[ 750, 6, 250 ], [ 600, 0, 250 ], [ 500, 8, 250 ], [ 400, 0, 250 ]
	];
	const distances = [ 0 ];
	for ( let index = 1; index < shape.length; index ++ ) {

		distances.push( distances.at( - 1 ) + separation( shape[ index - 1 ], shape[ index ] ) );

	}
	const indexes = [ 0, 2, 4, 6, 8 ];
	const stopIds = [ 'b0', 'b1', 'b2', 'b1', 'b0' ];
	const stops = indexes.map( ( shapeIndex, index ) => ( {
		stopId: stopIds[ index ], x: shape[ shapeIndex ][ 0 ], y: shape[ shapeIndex ][ 1 ],
		z: shape[ shapeIndex ][ 2 ], shapeDist: distances[ shapeIndex ]
	} ) );
	let clock = 0;
	const template = stops.map( ( stop, index ) => {

		if ( index ) clock += Math.round( ( stop.shapeDist - stops[ index - 1 ].shapeDist ) / 2 );
		const arrive = clock;
		if ( index < stops.length - 1 ) clock += 15;
		return { arrive, depart: clock };

	} );
	networks.transit.routes = [ {
		id: 'r0', kind: 'bus', lineId: 'r0', shape, stops, template,
		service: [ { start: 5 * 3600, end: 24 * 3600, headway: 600, phase: 0 } ]
	} ];
	return networks;

}

function network() {

	const hub = { id: 'hub', x: 500, y: 3, z: 250, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = parcel.access.point;
		nodes.push( { id, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( {
			id: `walk-${parcel.id}`, from: id, to: hub.id, kind: 'access', width: 2,
			path: [ [ x, z ], [ hub.x, hub.z ] ],
			path3: [ [ x, 1, z ], [ ( x + hub.x ) / 2, 7, ( z + hub.z ) / 2 ], [ hub.x, hub.y, hub.z ] ]
		} );

	}
	return {
		walk: { nodes, edges },
		transit: { routes: [ {
			id: 'unused-route', kind: 'bus', lineId: 'unused',
			stops: [
				{ stopId: 'unused-a', x: 5000, y: 0, z: 5000, shapeDist: 0 },
				{ stopId: 'unused-b', x: 5000, y: 0, z: 5000, shapeDist: 1 }
			],
			template: [ { arrive: 0, depart: 0 }, { arrive: 60, depart: 60 } ],
			service: [ { start: 0, end: 86400, headway: 600, phase: 0 } ]
		} ] }
	};

}

function walkingHome( controller ) {

	return controller.serialize().returns.map( ( walk ) => walk.npcId );

}

function walkOn( controller, npcId, request ) {

	controller.updateFollow( request );
	return controller.actor( npcId );

}

function startCompanion( controller, mode, npcId, playerPosition, pace = null, timeMin = MON_9 ) {

	return mode === 'following'
		? controller.startFollow( { npcId, timeMin, playerPosition, ...( pace ? { pace } : {} ) } )
		: controller.startLead( { npcId, timeMin, destination: { kind: 'parcel', id: 'p_clinic' }, ...( pace ? { pace } : {} ) } );

}

/** The version 1 shape of a save whose single slot held `follow`. */
function legacySave( save, follow ) {

	const { returns, follow: current, ...rest } = save;
	return { ...rest, version: '1', follow };

}

function separation( a, b ) { return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ); }

function code( run ) {

	try { run(); return null; }
	catch ( error ) { return error instanceof NpcContinuityError ? error.code : `unexpected:${error}`; }

}
