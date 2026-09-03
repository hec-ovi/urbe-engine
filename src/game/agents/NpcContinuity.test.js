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

function setup( simulation = null ) {

	const networks = network();
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

function simulationInput() {

	return {
		seed: FIXTURE_BLUEPRINT.meta.seed,
		blueprint: FIXTURE_BLUEPRINT,
		networks: network(),
		interiors: FIXTURE_INTERIORS
	};

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
