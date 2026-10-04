/**
 * A small world a companion acts in, for tests: the simulation's fixture city,
 * its walk network, a cafe with a lift and stairs, continuity and the
 * companion over them, and the day barista to talk to (`setup`).
 */
import { vi } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { StreetNames } from '../../../../quests/dist/runtime.js';
import { SimBridge } from '../sim/SimBridge.js';
import { NpcContinuity } from '../agents/NpcContinuity.js';
import { WalkRoutes } from '../agents/WalkRoutes.js';
import { CompanionGameplay } from './CompanionGameplay.js';

export const AFTERNOON = 16 * 60;
/** The cafe as its interior publishes it: a lift and stairs on two floors, a dining room and a kitchen below, offices above. */
export const CAFE_PLAN = {
	floors: [
		{ index: 0, elevation: 1, lifts: [ { id: 'elev-0', position: [ 302, 1, 258 ] } ], stairs: [ { id: 'stair-a', position: [ 298, 1, 258 ] } ],
			rooms: [ { id: 'floor:0/dining', kind: 'dining_room', position: [ 300, 1, 255 ] }, { id: 'floor:0/kitchen', kind: 'kitchen', position: [ 303, 1, 255 ] }, { id: 'floor:0/hall', kind: 'corridor', position: [ 300, 1, 252 ] } ] },
		{ index: 1, elevation: 5, lifts: [ { id: 'elev-0', position: [ 302, 5, 258 ] } ], stairs: [ { id: 'stair-a', position: [ 298, 5, 258 ] } ], rooms: [ { id: 'floor:1/office', kind: 'office', position: [ 300, 5, 255 ] } ] }
	],
	apartments: []
};

/** Interior routes over every building: straight from the door to the point. */
export function straightIndoors() {

	return { covers: () => true, route: ( parcelId, from, to ) => ( { path3: [ from, to ] } ) };

}

export function setup( overrides = {}, continuityOptions = {}, companionOptions = {} ) {

	const networks = network();
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	const routes = new WalkRoutes( networks );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( {
		kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ], 1, parcel.access.point[ 1 ] ], heading: 0
	} ) );
	const continuity = new NpcContinuity( { simulation: bridge, routes, places, ...continuityOptions } );
	const friend = bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: 9 * 60 } );
	const inside = {
		plan: vi.fn( ( parcelId ) => parcelId === 'p_cafe' ? CAFE_PLAN : null ),
		workSpot: vi.fn( () => null ),
		homeSpot: vi.fn( () => ( { position: [ 560, 4, 262 ], parcelId: 'p_r1', floor: 1, seated: true } ) ),
		seat: vi.fn( () => ( { position: [ 301, 1, 256 ], parcelId: 'p_cafe', floor: 0, heading: 0, seated: true } ) ),
		...overrides
	};
	const companion = new CompanionGameplay( {
		continuity, sim: bridge, routes, places, atlas: FIXTURE_BLUEPRINT, inside,
		streets: new StreetNames( FIXTURE_BLUEPRINT.streets ),
		people: () => [ { npcId: friend.npcId, name: 'Ada Ruiz', position: [ 250, 1, 405 ] } ],
		quests: { holdsCast: () => false, escorts: () => false, places: () => [], characterName: () => null },
		...companionOptions
	} );
	const game = {
		bridge, continuity, companion, inside, friend: friend.npcId,
		/** The day barista in the cafe at the afternoon minute, in a chat. */
		talkTo() {

			const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: 9 * 60 } );
			// Off shift in the afternoon, at the cafe's door with the player.
			continuity.hold( { npcId: npc.npcId, timeMin: AFTERNOON, position: [ 300, 1, 256 ], heading: 0, place: { kind: 'parcel', id: 'p_cafe' } } );
			const actor = continuity.actor( npc.npcId );
			continuity.releaseHold( { npcId: npc.npcId, timeMin: AFTERNOON } );
			continuity.beginConversation( { npcId: npc.npcId, timeMin: AFTERNOON, position: actor.position, heading: 0, place: actor.place, seated: false } );
			return continuity.actor( npc.npcId );

		},
		ask( { npcId, place }, timeMin = AFTERNOON ) {

			return { npcId, timeMin, playerPlaces: place?.kind === 'parcel' ? [ place ] : [] };

		},
		frame( timeMin, playerPosition ) {

			continuity.updateFollow( { timeMin, deltaSeconds: 1, playerPosition } );
			return companion.update( { timeMin, playerPosition, playerPlaces: [] } );

		}
	};
	return game;

}

function network() {

	const hub = { id: 'hub', x: 500, y: 1, z: 250, kind: 'corner' };
	const nodes = [ hub ];
	const edges = [];
	for ( const parcel of FIXTURE_BLUEPRINT.parcels ) {

		const id = `entry-${parcel.id}`;
		const [ x, z ] = parcel.access.point;
		nodes.push( { id, x, y: 1, z, kind: 'entry', ref: parcel.id } );
		edges.push( { id: `walk-${parcel.id}`, from: id, to: hub.id, kind: 'access', width: 2, path: [ [ x, z ], [ hub.x, hub.z ] ], path3: [ [ x, 1, z ], [ hub.x, hub.y, hub.z ] ] } );

	}
	return {
		walk: { nodes, edges },
		transit: { routes: [ {
			id: 'unused-route', kind: 'bus', lineId: 'unused',
			stops: [ { stopId: 'unused-a', x: 5000, y: 0, z: 5000, shapeDist: 0 }, { stopId: 'unused-b', x: 5000, y: 0, z: 5000, shapeDist: 1 } ],
			template: [ { arrive: 0, depart: 0 }, { arrive: 60, depart: 60 } ],
			service: [ { start: 0, end: 86400, headway: 600, phase: 0 } ]
		} ] }
	};

}
