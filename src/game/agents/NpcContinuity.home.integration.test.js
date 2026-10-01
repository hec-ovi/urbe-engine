import { beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_BLUEPRINT, FIXTURE_INTERIORS } from '../../../../simulation/dist/index.js';
import { expandBuilding, generate, makePlacementFixture } from '../../../../interior/src/index.ts';
import { findPath } from '../../../../interior/src/nav.ts';
import { SimBridge } from '../sim/SimBridge.js';
import { InteriorRoutes } from './InteriorRoutes.js';
import { NpcContinuity } from './NpcContinuity.js';
import { WalkRoutes } from './WalkRoutes.js';
import { roomAt, roomsOf, streetDoor, walls } from './interior-walls.test-fixtures.js';

const MON_9 = 9 * 60;
/** A frame, seconds. */
const FRAME = 0.25;
let tower;

beforeAll( async () => {

	const interior = await generate( makePlacementFixture( { width: 24, depth: 32, floors: 4, type: 'residential', tier: 'high_rich', seed: 11 } ) );
	const { npc } = expandBuilding( interior );
	const routes = new InteriorRoutes( new Map( [ [ 'p_r1', { npc, interior } ] ] ), { findPath } );
	tower = { interior, routes, plan: routes.plan( 'p_r1' ) };

}, 120000 );

/**
 * Somebody sent home, walked frame by frame through a real Interior tower:
 * in at its street door, to the lift, up in the car, along the corridor, the
 * numbered door asked open and on into the living room, never through a wall.
 */
describe( 'a person walking home through a real building', () => {

	it( 'goes from the street through the street door, rides the lift to their floor and waits at their own door until it opens', () => {

		const home = homeOf( 2 );
		const game = setup();
		const npc = game.held( 'street' );
		game.continuity.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: home.living, parcelId: 'p_r1', floor: 2 }, untilMin: MON_9 + 60 } );
		const seen = game.walk( npc.npcId, home );

		expect( game.continuity.errandsUnderway[ 0 ].arrived ).toBe( true );
		expect( seen.at( - 1 ) ).toEqual( home.living );
		game.continuity.updateFollow( { timeMin: MON_9 + 30, deltaSeconds: FRAME, playerPosition: [ 1000, 0, 1000 ] } );
		expect( game.continuity.actor( npc.npcId ) ).toMatchObject( { mode: 'errand', animation: 'idle', position: home.living, place: { kind: 'parcel', id: 'p_r1', floor: 2 } } );
		walls( tower.interior, seen, 'home' );
		// It came in by the street door, rode the lift and asked its own door open.
		expect( seen.some( ( point ) => roomAt( roomsOf( tower.interior, 0 ), point ) !== null ) ).toBe( true );
		expect( game.calls.ride ).toContain( 'call' );
		expect( game.calls.ride.at( - 1 ) ).toBe( 'done' );
		// Off the floors only in the car, in the lift's shaft.
		const levels = tower.interior.building.floors.map( ( floor ) => floor.elevation );
		const riding = seen.filter( ( point ) => ! levels.some( ( level ) => Math.abs( level - point[ 1 ] ) < 0.01 ) );
		expect( riding.length ).toBeGreaterThan( 3 );
		for ( const point of riding ) expect( roomAt( roomsOf( tower.interior, 0 ), point ) ).toMatch( /^elev/ );
		expect( game.calls.doors ).toEqual( expect.arrayContaining( [ home.apartment.door ] ) );
		expect( game.closedInside ).toBe( 0 );

	} );

	it( 'climbs the stairs where no lift runs, every step on a flight, and enters the same way', () => {

		const home = homeOf( 1 );
		const game = setup( { lift: false } );
		const npc = game.held( 'door' );
		game.continuity.sendOnErrand( { npcId: npc.npcId, timeMin: MON_9, target: { position: home.living, parcelId: 'p_r1', floor: 1 }, untilMin: MON_9 + 60 } );
		const seen = game.walk( npc.npcId, home );

		expect( game.continuity.errandsUnderway[ 0 ].arrived ).toBe( true );
		walls( tower.interior, seen, 'home by the stairs' );
		const ground = tower.interior.building.floors[ 0 ].elevation;
		const first = tower.interior.building.floors[ 1 ].elevation;
		const climbing = seen.filter( ( point ) => point[ 1 ] > ground + 0.01 && point[ 1 ] < first - 0.01 );
		expect( climbing.length ).toBeGreaterThan( 0 );
		for ( const point of climbing ) expect( roomAt( roomsOf( tower.interior, 0 ), point, 0.3 ) ).toMatch( /^(stair|elev)/ );
		expect( game.closedInside ).toBe( 0 );

	} );

} );

/** An apartment on `floor` and the middle of its living room. */
function homeOf( floor ) {

	const apartment = tower.plan.apartments.find( ( entry ) => entry.floor === floor );
	const living = tower.plan.floors.find( ( entry ) => entry.index === floor ).rooms.find( ( room ) => room.unit === apartment.unit && room.kind === 'living' );
	return { apartment, living: living.position, private: living.id.split( '/' ).at( - 1 ) };

}

function setup( { lift = true } = {} ) {

	const door = streetDoor( tower.interior );
	// The street door stands on the building's front, z = 0.5: the doorstep is 3 m out, the street 20 m further.
	const doorstep = [ door[ 0 ], 0, door[ 2 ] - 3.6 ];
	const corner = [ door[ 0 ], 0, door[ 2 ] - 23.6 ];
	const networks = {
		walk: {
			nodes: [ { id: 'corner', x: corner[ 0 ], y: 0, z: corner[ 2 ], kind: 'corner' }, { id: 'entry-p_r1', x: doorstep[ 0 ], y: 0, z: doorstep[ 2 ], kind: 'entry', ref: 'p_r1' } ],
			edges: [ { id: 'walk-p_r1', from: 'entry-p_r1', to: 'corner', kind: 'access', width: 2, path: [ [ doorstep[ 0 ], doorstep[ 2 ] ], [ corner[ 0 ], corner[ 2 ] ] ], path3: [ doorstep, corner ] } ]
		},
		transit: { routes: [ {
			id: 'unused-route', kind: 'bus', lineId: 'unused',
			stops: [ { stopId: 'unused-a', x: 5000, y: 0, z: 5000, shapeDist: 0 }, { stopId: 'unused-b', x: 5000, y: 0, z: 5000, shapeDist: 1 } ],
			template: [ { arrive: 0, depart: 0 }, { arrive: 60, depart: 60 } ],
			service: [ { start: 0, end: 86400, headway: 600, phase: 0 } ]
		} ] }
	};
	const buildings = new Map( Object.entries( FIXTURE_INTERIORS ).map( ( [ id, npc ] ) => [ id, { npc } ] ) );
	const bridge = SimBridge.create( FIXTURE_BLUEPRINT, { networks }, buildings );
	// The tower stands for p_r1; the city's other parcels keep their own places, far off.
	const places = FIXTURE_BLUEPRINT.parcels.map( ( parcel ) => parcel.id === 'p_r1'
		? { kind: 'parcel', id: 'p_r1', position: door, doorstep, heading: 0, anchors: [] }
		: { kind: 'parcel', id: parcel.id, position: [ parcel.access.point[ 0 ] + 1000, 0, parcel.access.point[ 1 ] ], heading: 0 } );
	const levels = new Map( tower.interior.building.floors.map( ( floor ) => [ floor.index, floor.elevation ] ) );
	const calls = { doors: [], ride: [] };
	const opened = new Map();
	const car = { y: null };
	const ways = {
		/** A door opens on the third ask. */
		pass( npcId, gate ) {

			const key = gate.position.join( ',' );
			opened.set( key, ( opened.get( key ) ?? 0 ) + 1 );
			if ( ! calls.doors.some( ( position ) => position.join( ',' ) === key ) ) calls.doors.push( gate.position );
			return opened.get( key ) >= 3;

		},
		/** The car comes on the third call, then rises half a metre a frame to the floor asked. */
		ride( npcId, gate, stage ) {

			calls.ride.push( stage );
			if ( ! lift ) return null;
			if ( stage === 'call' ) {

				car.y = levels.get( gate.fromFloor );
				return calls.ride.filter( ( entry ) => entry === 'call' ).length >= 3 ? 'board' : 'wait';

			}
			if ( stage === 'ride' ) {

				const to = levels.get( gate.toFloor );
				car.y = Math.min( to, car.y + 0.5 );
				return car.y >= to ? 'alight' : { y: car.y };

			}
			return 'done';

		}
	};
	const routes = lift ? tower.routes : new InteriorRoutes( new Map( [ [ 'p_r1', withoutLift() ] ] ), { findPath } );
	const continuity = new NpcContinuity( { simulation: bridge, routes: new WalkRoutes( networks ), places, interiorRoutes: routes, ways } );
	const game = {
		continuity, calls, closedInside: 0,
		/** A resident held at the street corner, or just inside the street door. */
		held( where ) {

			const npc = bridge.getNPCVendor( { parcelId: 'p_cafe', timeMin: MON_9 } );
			const at = where === 'street' ? [ ...corner ] : [ ...door ];
			const place = where === 'street' ? { kind: 'edge', id: 'walk-p_r1' } : { kind: 'parcel', id: 'p_r1' };
			continuity.hold( { npcId: npc.npcId, timeMin: MON_9, position: at, heading: 0, place } );
			return npc;

		},
		/** Frames until the errand arrives, the body's positions on the way; counts frames spent in the home while its door was shut. */
		walk( npcId, home ) {

			const seen = [ [ ...continuity.actor( npcId ).position ] ];
			const key = home.apartment.door.join( ',' );
			for ( let step = 0; step < 4000 && ! continuity.errandsUnderway[ 0 ].arrived; step ++ ) {

				continuity.updateFollow( { timeMin: MON_9 + step * FRAME / 60, deltaSeconds: FRAME, playerPosition: [ 1000, 0, 1000 ] } );
				const at = [ ...continuity.actor( npcId ).position ];
				seen.push( at );
				const shut = ( opened.get( key ) ?? 0 ) < 3;
				const floor = [ ...levels ].find( ( [ , y ] ) => Math.abs( y - at[ 1 ] ) < 0.01 )?.[ 0 ];
				if ( shut && floor === home.apartment.floor && roomAt( roomsOf( tower.interior, floor ), at ) === home.private ) game.closedInside ++;

			}
			return seen;

		}
	};
	return game;

}

/** The tower as a building whose lift is out of the navigation, so only its stairs connect the floors. */
function withoutLift() {

	const { npc, interior } = { npc: expandBuilding( tower.interior ).npc, interior: tower.interior };
	return { npc: { ...npc, nav: { ...npc.nav, connectors: npc.nav.connectors.filter( ( connector ) => connector.kind !== 'elevator' ) } }, interior };

}
