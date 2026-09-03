import { describe, expect, it } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS, restoreSimulation } from '../../../../simulation/dist/index.js';
import { SimBridge } from '../sim/SimBridge.js';
import { CLIP, clipForNpcAnimation } from './CharacterAssets.js';
import { NpcContinuity, selectNpcAnimation } from './NpcContinuity.js';
import { NpcContinuityError } from './NpcContinuityError.js';
import { WalkRoutes } from './WalkRoutes.js';

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
		let previous = actor.position;
		for ( let step = 0; step < 300 && actor.mode === 'resuming'; step ++ ) {

			actor = controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: player } );
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
		const unmatched = setup();
		expect( code( () => unmatched.controller.restore( saved ) ) ).toBe( 'E_NPC_INPUT' );
		expect( unmatched.controller.serialize().actors ).toEqual( [] );

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
		const unowned = structuredClone( saved );
		unowned.pose = null;
		expect( code( () => setup( restoreSimulation( simulationInput(), first.bridge.simulation.serialize() ) )
			.controller.restore( unowned ) ) ).toBe( 'E_NPC_INPUT' );

		let returning = restored.controller.releaseCrouch( { npcId: npc.npcId, timeMin: startedAt + 1 } );
		expect( restored.controller.serialize().pose ).toBeNull();
		expect( restored.bridge.behaviorAt( npc.npcId, startedAt + 1 ).interrupted ).toBe( false );
		for ( let step = 0; step < 300 && returning.mode === 'resuming'; step ++ ) {

			returning = restored.controller.updateFollow( {
				timeMin: startedAt + 1, deltaSeconds: 1, playerPosition: [ 560, 1, 250 ]
			} );

		}
		expect( returning ).toMatchObject( { npcId: npc.npcId, mode: 'schedule', animation: 'walk' } );
		expect( code( () => restored.controller.releaseCrouch( {
			npcId: npc.npcId, timeMin: startedAt + 2
		} ) ) ).toBe( 'E_NPC_CONFLICT' );

	} );

	it( 'virtualizes distant scheduled bodies and restores the same identity when they are requested again', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const actor = controller.appear( { npcId: npc.npcId, timeMin: MON_9 } );
		const [ hidden ] = controller.updateVisible( {
			timeMin: MON_9 + 1,
			playerPosition: [ actor.position[ 0 ] + 200, actor.position[ 1 ], actor.position[ 2 ] ],
			maxDistance: 100
		} );

		expect( hidden ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: actor.appearanceSeed, visible: false
		} );
		const [ nearAgain ] = controller.updateVisible( {
			timeMin: MON_9 + 2, playerPosition: actor.position, maxDistance: 100
		} );
		expect( nearAgain ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: actor.appearanceSeed, visible: true
		} );
		const returned = controller.appear( { npcId: npc.npcId, timeMin: MON_9 + 2 } );
		expect( returned ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: actor.appearanceSeed, gender: actor.gender, visible: true
		} );

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

			returning = controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: visible } );

		}
		expect( returning ).toMatchObject( { npcId: npc.npcId, mode: 'schedule', place: { kind: 'parcel', id: 'p_cafe' } } );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 1 ).interrupted ).toBe( false );

	} );

	it( 'pauses a follower for conversation without releasing its interruption', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		const player = [ 560, 1, 250 ];
		const following = controller.startFollow( { npcId: npc.npcId, timeMin: MON_9, playerPosition: player } );
		controller.beginConversation( {
			npcId: npc.npcId, timeMin: MON_9, position: following.position, heading: following.heading,
			place: following.place, seated: false
		} );
		expect( controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: player } ).mode ).toBe( 'conversation' );
		expect( controller.endConversation( { timeMin: MON_9 + 1 } ).mode ).toBe( 'following' );
		expect( controller.serialize() ).toMatchObject( {
			follow: { npcId: npc.npcId, mode: 'following', source: 'follow' }, conversation: null
		} );
		expect( bridge.behaviorAt( npc.npcId, MON_9 + 2 ).interrupted ).toBe( true );

	} );

	it( 'rejects unavailable places and releases a follower that becomes unavailable', () => {

		const { bridge, controller } = setup();
		expect( code( () => controller.startFollow( { npcId: 'missing', timeMin: MON_9, playerPosition: [ 0, 0, 0 ] } ) ) ).toBe( 'E_NPC_UNKNOWN' );

		const driver = bridge.getNPCVendor( { role: 'driver', timeMin: MON_9 } );
		expect( code( () => controller.startFollow( { npcId: driver.npcId, timeMin: MON_9, playerPosition: [ 0, 0, 0 ] } ) ) ).toBe( 'E_NPC_PLACE' );

		const worker = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		controller.startFollow( { npcId: worker.npcId, timeMin: MON_9, playerPosition: [ 560, 1, 250 ] } );
		bridge.applyFlag( worker.npcId, { kind: 'die' } );
		const released = controller.updateFollow( { timeMin: MON_9 + 1, deltaSeconds: 1, playerPosition: [ 560, 1, 250 ] } );
		expect( released.mode ).toBe( 'released' );
		expect( controller.serialize().follow ).toBeNull();

	} );

	it( 'rejects malformed requests and identity-mismatched restore data at the public boundary', () => {

		const { bridge, controller } = setup();
		const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
		expect( code( () => controller.startFollow( { npcId: npc.npcId, timeMin: MON_9 } ) ) ).toBe( 'E_NPC_INPUT' );
		const actor = controller.appear( { npcId: npc.npcId, timeMin: MON_9 } );
		const invalid = controller.serialize();
		invalid.actors[ 0 ] = { ...actor, appearanceSeed: ( actor.appearanceSeed + 1 ) >>> 0 };
		expect( code( () => controller.restore( invalid ) ) ).toBe( 'E_NPC_INPUT' );

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

function separation( a, b ) { return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ); }

function code( run ) {

	try { run(); return null; }
	catch ( error ) { return error instanceof NpcContinuityError ? error.code : `unexpected:${error}`; }

}
