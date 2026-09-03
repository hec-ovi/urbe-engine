import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../simulation/dist/index.js';
import { Crowd } from './agents/Crowd.js';
import { NpcContinuity } from './agents/NpcContinuity.js';
import { WalkRoutes } from './agents/WalkRoutes.js';
import { QuestGameplay } from './quests/QuestGameplay.js';
import { QuestSession } from './quests/QuestSession.js';
import { SimBridge } from './sim/SimBridge.js';

const TIME = 9 * 60;
const PLAYER = new THREE.Vector3( 330, 1, 250 );

describe( 'live NPC gameplay integration', () => {

	it( 'keeps one cast identity through follow, rendered movement, save restore, release and schedule return', () => {

		const first = runtime();
		const npc = first.bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: TIME } );
		const firstGameplay = gameplay( first, npc.npcId );
		expect( firstGameplay.control( control( 'start-follow', npc.npcId, TIME ) ) ).toEqual( {
			ok: true, kind: 'start-follow', npcId: npc.npcId, mode: 'following'
		} );
		const moved = first.controller.updateFollow( {
			timeMin: TIME, deltaSeconds: 1, playerPosition: PLAYER.toArray()
		} );
		const firstBody = first.crowd.syncActor( moved, PLAYER );
		expect( firstBody ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: npc.appearanceSeed, controlMode: 'following'
		} );
		const save = {
			timeMin: TIME,
			simulation: first.bridge.serialize(),
			continuity: first.controller.serialize()
		};

		const restored = runtime( save );
		const restoredActor = restored.controller.appear( { npcId: npc.npcId, timeMin: save.timeMin } );
		const restoredBody = restored.crowd.syncActor( restoredActor, PLAYER );
		expect( restoredActor ).toEqual( save.continuity.actors[ 0 ] );
		expect( restoredBody ).toMatchObject( {
			npcId: npc.npcId,
			appearanceSeed: firstBody.appearanceSeed,
			variant: firstBody.variant,
			look: firstBody.look
		} );
		expect( restored.crowd.count ).toBe( 1 );

		const restoredGameplay = gameplay( restored, npc.npcId );
		const beforeRelease = restoredBody.position.toArray();
		expect( restoredGameplay.control( control( 'release-follow', npc.npcId, TIME + 1 ) ) )
			.toMatchObject( { ok: true, npcId: npc.npcId, mode: 'resuming' } );
		expect( restored.crowd.members.values().next().value.position.toArray() ).toEqual( beforeRelease );
		let actor = restored.controller.serialize().actors[ 0 ];
		for ( let step = 0; step < 300 && actor.mode === 'resuming'; step ++ ) {

			actor = restored.controller.updateFollow( {
				timeMin: TIME + 1, deltaSeconds: 1, playerPosition: PLAYER.toArray()
			} );
			restored.crowd.syncActor( actor, PLAYER );

		}
		expect( actor ).toMatchObject( {
			npcId: npc.npcId, appearanceSeed: npc.appearanceSeed,
			mode: 'schedule', place: { kind: 'parcel', id: 'p_cafe' }
		} );
		expect( restored.bridge.behaviorAt( npc.npcId, TIME + 1 ).interrupted ).toBe( false );

	} );

} );

function runtime( save = null ) {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create(
		FIXTURE_BLUEPRINT, { networks }, buildings, {}, null, save?.simulation ?? null
	);
	const routes = new WalkRoutes( networks );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id,
		position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ],
		heading: 0,
		anchors: []
	} ) );
	const controller = new NpcContinuity( { simulation: bridge, routes, places } );
	if ( save ) controller.restore( save.continuity );
	const crowd = new Crowd( {
		assets: { variants: [ {}, {} ], durations: Array( 7 ).fill( 1 ), meshesOf: () => [] },
		routes, signals: { green: () => true }, sim: bridge, places: new Map(), capacity: 4, continuity: controller
	} );
	return { bridge, controller, crowd };

}

function gameplay( state, npcId ) {

	const session = new QuestSession( [ { definition: { id: 'fixture' }, runtime: { cast: { guide: npcId } } } ], state.bridge );
	return new QuestGameplay( {
		session,
		actions: {},
		world: { parcels: [] },
		crowd: state.crowd,
		continuity: state.controller,
		materialFactory: {}
	} );

}

function control( kind, npcId, timeMin ) {

	return {
		kind, npcId, timeMin,
		playerPosition: { x: PLAYER.x, y: PLAYER.y, z: PLAYER.z }
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
