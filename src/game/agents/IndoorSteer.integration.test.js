import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { expandBuilding, generate, makePlacementFixture } from '../../../../interior/src/index.ts';
import { findPath } from '../../../../interior/src/nav.ts';
import { SimBridge } from '../sim/SimBridge.js';
import { InteriorRoutes } from './InteriorRoutes.js';
import { INDOOR_RADIUS, IndoorSteer } from './IndoorSteer.js';
import { NpcContinuity } from './NpcContinuity.js';
import { WalkRoutes } from './WalkRoutes.js';

const MON_9 = 9 * 60;
const FRAME = 0.1;
let tower;

beforeAll( async () => {

	const interior = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 4, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	const { npc } = expandBuilding( interior );
	const routes = new InteriorRoutes( new Map( [ [ 'p_r1', { npc, interior } ] ] ), { findPath } );
	tower = { interior, routes, plan: routes.plan( 'p_r1' ), elevation: ( floor ) => interior.building.floors.find( ( f ) => f.index === floor ).elevation };

}, 120000 );

/**
 * People walking inside a real Interior tower, as continuity walks them and
 * the crowd draws them: two meeting in its corridor pass each other, one
 * going into a flat through its door while another comes out waits its turn,
 * and somebody walking down the corridor passes the player standing in it.
 * Nobody is ever drawn inside anybody else, nobody stands for ever, and every
 * body stands on the building's walkable floor.
 */
describe( 'people inside a real building giving way to each other', () => {

	it( 'passes two people meeting in a corridor on their own right, both on the walkable floor', () => {

		const y = tower.elevation( 1 ), corridor = corridorOf( 1 );
		const world = setup();
		const [ a, b ] = world.walkers( [ [ corridor.x, y, corridor.z0 + 1 ], [ corridor.x, y, corridor.z1 - 1 ] ], [ [ corridor.x, y, corridor.z1 - 1 ], [ corridor.x, y, corridor.z0 + 1 ] ] );
		const seen = world.run();
		expect( world.arrived( a ) && world.arrived( b ) ).toBe( true );
		expect( closest( seen, a, b ) ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.05 );
		for ( const frame of seen ) for ( const at of Object.values( frame ) ) expect( tower.routes.stands( 'p_r1', at ), `${at}` ).toBe( true );

	} );

	it( 'lets one through a flat\'s door at a time: the one coming out waits for the one going in, neither stands for ever', () => {

		const apartment = tower.plan.apartments.find( ( entry ) => entry.floor === 1 );
		const living = tower.plan.floors.find( ( floor ) => floor.index === 1 ).rooms.find( ( room ) => room.unit === apartment.unit && room.kind === 'living' );
		const y = tower.elevation( 1 ), corridor = corridorOf( 1 );
		const world = setup();
		// One goes in from the corridor below the door, the other comes out to the corridor above it.
		const [ inbound, outbound ] = world.walkers(
			[ [ corridor.x, y, apartment.door[ 2 ] - 5 ], living.position ],
			[ living.position, [ corridor.x, y, apartment.door[ 2 ] + 5 ] ]
		);
		const seen = world.run( 1500 );
		expect( world.arrived( inbound ) && world.arrived( outbound ) ).toBe( true );
		expect( closest( seen, inbound, outbound ) ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.12 );

	} );

	it( 'lets somebody step out of a lift past the one waiting at its landing, and the one waiting ride on after, neither stuck', () => {

		const lift = tower.plan.floors.find( ( floor ) => floor.index === 1 ).lifts[ 0 ];
		const corridor = corridorOf( 1 ), y1 = tower.elevation( 1 ), y2 = tower.elevation( 2 );
		// One waits at the first floor's landing for a slow car up; the other comes down from the second floor and walks off past them.
		const world = setup();
		const [ waiting, arriving ] = world.walkers(
			[ [ lift.position[ 0 ], y1, lift.position[ 2 ] ], [ corridor.x, y2, lift.position[ 2 ] + 4 ] ],
			[ [ corridor.x, y2, lift.position[ 2 ] - 4 ], [ corridor.x, y1, lift.position[ 2 ] + 6 ] ],
			[ 2, 1 ]
		);
		world.slow( waiting, 70 );
		const seen = world.run( 1500 );
		expect( world.arrived( waiting ) && world.arrived( arriving ) ).toBe( true );
		const together = seen.filter( ( frame ) => Math.abs( frame[ waiting ][ 1 ] - frame[ arriving ][ 1 ] ) < 1 );
		expect( together.length ).toBeGreaterThan( 0 );
		expect( Math.min( ...together.map( ( frame ) => Math.hypot( frame[ waiting ][ 0 ] - frame[ arriving ][ 0 ], frame[ waiting ][ 2 ] - frame[ arriving ][ 2 ] ) ) ) )
			.toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.15 );

	} );

	it( 'walks a person down the corridor past the player standing in it, never through them', () => {

		const y = tower.elevation( 1 ), corridor = corridorOf( 1 );
		const player = [ corridor.x, y, ( corridor.z0 + corridor.z1 ) / 2 ];
		const world = setup( player );
		const [ a ] = world.walkers( [ [ corridor.x, y, corridor.z0 + 1 ] ], [ [ corridor.x, y, corridor.z1 - 1 ] ] );
		const seen = world.run();
		expect( world.arrived( a ) ).toBe( true );
		const nearest = Math.min( ...seen.map( ( frame ) => Math.hypot( frame[ a ][ 0 ] - player[ 0 ], frame[ a ][ 2 ] - player[ 2 ] ) ) );
		expect( nearest ).toBeGreaterThanOrEqual( INDOOR_RADIUS * 2 - 0.05 );

	} );

} );

/** The middle line and ends of a floor's main corridor, from the rooms the building draws. */
function corridorOf( floor ) {

	const record = tower.interior.building.floors.find( ( f ) => f.index === floor );
	const room = tower.interior.layouts[ record.layout ].floor.rooms.find( ( r ) => r.kind === 'corridor' && r.id.endsWith( '-corridor' ) );
	const xs = room.polygon.map( ( p ) => p[ 0 ] ), zs = room.polygon.map( ( p ) => p[ 1 ] );
	return { x: ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, z0: Math.min( ...zs ), z1: Math.max( ...zs ) };

}

function closest( seen, a, b ) {

	return Math.min( ...seen.map( ( frame ) => Math.hypot( frame[ a ][ 0 ] - frame[ b ][ 0 ], frame[ a ][ 2 ] - frame[ b ][ 2 ] ) ) );

}

function setup( player = null ) {

	// Each walker's lift: the car comes after its own number of calls (3 unless slowed), rides a frame and opens.
	const calls = new Map(), slow = new Map();
	const ride = ( npcId, gate, stage ) => {

		if ( stage === 'call' ) {

			calls.set( npcId, ( calls.get( npcId ) ?? 0 ) + 1 );
			return calls.get( npcId ) > ( slow.get( npcId ) ?? 3 ) ? 'board' : 'wait';

		}
		return stage === 'ride' ? 'alight' : 'done';

	};

	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks: network() }, new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) ) );
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => ( { kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ] + ( parcel.id === 'p_r1' ? 0 : 1000 ), 0, parcel.access.point[ 1 ] ], heading: 0 } ) );
	const steer = new IndoorSteer( { walkable: ( parcelId, point ) => tower.routes.stands( parcelId, point ) } );
	const ways = { pass: () => true, ride, travel: ( npcId, wanted ) => steer.travel( npcId, wanted ) };
	const continuity = new NpcContinuity( { simulation: bridge, routes: new WalkRoutes( network() ), places, interiorRoutes: tower.routes, ways } );
	const ids = [];
	const people = [ bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } ), bridge.getNPCVendor( { parcelId: 'p_clinic', timeMin: MON_9 } ) ];
	return {
		/** People held at `from`, each sent on an errand to its `to` (on floor 1 unless `floors` says); their npcIds. */
		walkers( from, to, floors = [] ) {

			from.forEach( ( at, index ) => {

				const npc = people[ index ];
				continuity.hold( { npcId: npc.npcId, timeMin: MON_9, position: [ ...at ], heading: 0, place: { kind: 'parcel', id: 'p_r1' } } );
				continuity.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: [ ...to[ index ] ], parcelId: 'p_r1', floor: floors[ index ] ?? 1 }, untilMin: MON_9 + 600 } );
				ids.push( npc.npcId );

			} );
			return [ ...ids ];

		},
		/** The calls a walker's lift car takes to come. */
		slow( npcId, count ) {

			slow.set( npcId, count );

		},
		arrived( npcId ) {

			return continuity.errandsUnderway.find( ( errand ) => errand.npcId === npcId )?.arrived ?? false;

		},
		/** Frames until everybody arrived: where each is drawn, stepped aside from its line. */
		run( frames = 900 ) {

			const seen = [];
			for ( let frame = 0; frame < frames && ! ids.every( ( id ) => this.arrived( id ) ); frame ++ ) {

				continuity.updateFollow( { timeMin: MON_9 + frame * FRAME / 60, deltaSeconds: FRAME, playerPosition: player ?? [ 1000, 0, 1000 ] } );
				const bodies = ids.map( ( id ) => {

					const actor = continuity.actor( id );
					return { id, parcelId: 'p_r1', position: actor.position, heading: actor.heading, moving: ! this.arrived( id ), priority: 2 };

				} );
				steer.update( bodies, player, FRAME );
				seen.push( Object.fromEntries( bodies.map( ( body ) => {

					const offset = steer.offset( body.id );
					return [ body.id, [ body.position[ 0 ] + Math.cos( body.heading ) * offset, body.position[ 1 ], body.position[ 2 ] - Math.sin( body.heading ) * offset ] ];

				} ) ) );

			}
			return seen;

		}
	};

}

function network() {

	const hub = { id: 'hub', x: 500, y: 1, z: 240, kind: 'corner' };
	const nodes = [ hub ], edges = [];
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
