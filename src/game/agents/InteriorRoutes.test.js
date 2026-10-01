import { describe, expect, it } from 'vitest';
import { InteriorRoutes } from './InteriorRoutes.js';

const NAV = { cellSize: 1, floors: [ { floor: 0 }, { floor: 1 } ], connectors: [] };

describe( 'interior routes', () => {

	it( 'walks a building across its floors at their published elevations, from and to the exact points', () => {

		const asked = [];
		const routes = new InteriorRoutes( buildings(), { findPath: ( request ) => {

			asked.push( request );
			return {
				legs: [ { floor: 0, points: [ [ 10, 10 ], [ 12, 10 ] ] }, { floor: 1, points: [ [ 12, 11 ], [ 20, 20 ] ] } ],
				connectors: [ { id: 'stair-a', kind: 'stair', fromFloor: 0, toFloor: 1, from: [ 12, 10 ], to: [ 12, 11 ] } ]
			};

		} } );
		expect( routes.route( 'p1', [ 10, 1.2, 10 ], [ 20.4, 4.6, 20 ] ) ).toEqual( {
			path3: [ [ 10, 1.2, 10 ], [ 10, 1, 10 ], [ 12, 1, 10 ], [ 12, 4.5, 11 ], [ 20, 4.5, 20 ], [ 20.4, 4.6, 20 ] ]
		} );
		expect( asked ).toEqual( [ { nav: NAV, from: { floor: 0, x: 10, z: 10 }, to: { floor: 1, x: 20.4, z: 20 } } ] );

	} );

	it( 'covers only buildings with navigation and floors, and has no way where navigation finds none', () => {

		const routes = new InteriorRoutes( buildings(), { findPath: () => ( { error: { code: 'E_NAV_UNREACHABLE', message: 'no route' } } ) } );
		expect( [ 'p1', 'p2', 'p3' ].map( ( id ) => routes.covers( id ) ) ).toEqual( [ true, false, false ] );
		expect( routes.route( 'p1', [ 10, 1, 10 ], [ 20, 1, 20 ] ) ).toBeNull();
		expect( routes.route( 'p2', [ 10, 1, 10 ], [ 20, 1, 20 ] ) ).toBeNull();
		const strange = new InteriorRoutes( buildings(), { findPath: () => ( { legs: [ { floor: 7, points: [ [ 1, 1 ] ] } ], connectors: [] } ) } );
		expect( strange.route( 'p1', [ 10, 1, 10 ], [ 20, 1, 20 ] ) ).toBeNull();

	} );

	it( 'follows buildings as streamed cells load and drop them', () => {

		const streamed = new Map();
		const navs = [];
		const routes = new InteriorRoutes( streamed, { findPath: ( { nav } ) => {

			navs.push( nav );
			return { legs: [ { floor: 0, points: [ [ 12, 10 ] ] } ], connectors: [] };

		} } );
		expect( routes.covers( 'p1' ) ).toBe( false );
		streamed.set( 'p1', buildings().get( 'p1' ) );
		expect( routes.covers( 'p1' ) ).toBe( true );
		expect( routes.route( 'p1', [ 10, 1, 10 ], [ 14, 1, 10 ] ) ).toEqual( { path3: [ [ 10, 1, 10 ], [ 12, 1, 10 ], [ 14, 1, 10 ] ] } );
		streamed.delete( 'p1' );
		expect( routes.covers( 'p1' ) ).toBe( false );
		expect( routes.route( 'p1', [ 10, 1, 10 ], [ 14, 1, 10 ] ) ).toBeNull();
		// Loaded again, the building is walked over the record it came back with.
		const again = { npc: { nav: { ...NAV } }, interior: { building: { floors: [ { index: 0, elevation: 2 } ] } } };
		streamed.set( 'p1', again );
		expect( routes.route( 'p1', [ 10, 2, 10 ], [ 14, 2, 10 ] ) ).toEqual( { path3: [ [ 10, 2, 10 ], [ 12, 2, 10 ], [ 14, 2, 10 ] ] } );
		expect( navs.at( - 1 ) ).toBe( again.npc.nav );

	} );


	it( 'climbs a stair on its own flights, rides a lift as a gate from landing to landing, and gates the apartment doors it passes', () => {

		const routes = new InteriorRoutes( new Map( [ [ 'p9', TOWER ] ] ), { findPath: ( { from, to } ) => from.floor === to.floor
			? { legs: [ { floor: from.floor, points: [ [ from.x, from.z ], [ to.x, to.z ] ] } ], connectors: [] }
			: to.floor === 1
				? { legs: [ { floor: 0, points: [ [ 2, 0 ], [ 2, 1 ] ] }, { floor: 1, points: [ [ 2, 1 ], [ 6, 1 ], [ 6, 5 ] ] } ],
					connectors: [ { id: 'stair-a', kind: 'stair', fromFloor: 0, toFloor: 1, from: [ 2, 1 ], to: [ 2, 1 ] } ] }
				: { legs: [ { floor: 0, points: [ [ 2, 0 ], [ 10, 1 ] ] }, { floor: 2, points: [ [ 10, 1 ], [ 6, 1 ] ] } ],
					connectors: [ { id: 'elev-0', kind: 'elevator', fromFloor: 0, toFloor: 2, from: [ 10, 1 ], to: [ 10, 1 ] } ] } } );

		// Up the stair: no step rises more than a riser, then through the door of 101.
		const up = routes.route( 'p9', [ 2, 0, 0 ], [ 6, 4, 5 ] );
		const rises = up.path3.slice( 1 ).map( ( point, index ) => point[ 1 ] - up.path3[ index ][ 1 ] );
		expect( Math.max( ...rises ) ).toBeLessThanOrEqual( 0.21 );
		expect( up.path3.filter( ( point ) => point[ 1 ] > 0 && point[ 1 ] < 4 ).length ).toBeGreaterThanOrEqual( 20 );
		expect( up.gates ).toEqual( [ expect.objectContaining( { kind: 'door', parcelId: 'p9', floor: 1, position: [ 6, 4, 3 ] } ) ] );

		// Up the lift: wait at the landing, stand in the car's middle, ride the shaft, step out onto the landing above.
		const ride = routes.route( 'p9', [ 2, 0, 0 ], [ 6, 8, 1 ] );
		const [ lift ] = ride.gates;
		expect( lift ).toMatchObject( { kind: 'lift', parcelId: 'p9', shaft: 'elev-0', fromFloor: 0, toFloor: 2 } );
		const at = ( metres ) => ride.path3.find( ( point, index ) => Math.abs( distanceTo( ride.path3, index ) - metres ) < 1e-6 );
		expect( at( lift.from ) ).toEqual( [ 10, 0, 1 ] );
		expect( at( lift.board ) ).toEqual( [ 10, 0, 3 ] );
		expect( at( lift.alight ) ).toEqual( [ 10, 8, 3 ] );
		expect( at( lift.to ) ).toEqual( [ 10, 8, 1 ] );

	} );

	it( 'reads the building\'s circulation: each floor\'s lift landings, stair entries and rooms, and the apartment doors with the spot in front', () => {

		const plan = new InteriorRoutes( new Map( [ [ 'p9', TOWER ] ] ), { findPath: () => null } ).plan( 'p9' );
		expect( plan.floors.map( ( floor ) => [ floor.index, floor.lifts.length, floor.stairs.length, floor.rooms.map( ( room ) => room.kind ) ] ) )
			.toEqual( [ [ 0, 1, 1, [ 'lobby' ] ], [ 1, 1, 1, [ 'corridor', 'living' ] ], [ 2, 1, 0, [ 'corridor' ] ] ] );
		expect( plan.floors[ 0 ].lifts[ 0 ] ).toEqual( { id: 'elev-0', position: [ 10, 0, 1 ] } );
		expect( plan.apartments ).toEqual( [ { floor: 1, unit: 'f1-home-1', number: '101', door: [ 6, 4, 3 ], front: [ 6, 4, 2.1 ] } ] );

	} );
} );

function buildings() {

	return new Map( [
		[ 'p1', { npc: { nav: NAV }, interior: { building: { floors: [ { index: 1, elevation: 4.5 }, { index: 0, elevation: 1 } ] } } } ],
		[ 'p2', { npc: null, interior: null } ]
	] );

}

/** A three-floor tower: a stair from the ground to the first floor with two flights, a lift to every floor, apartment 101 on the first floor. */
const flight = ( id, y, rotationY, x, z ) => ( { id, module: 'stair-flight-12', connector: 'stair-a', position: [ x, y, z ], rotationY, scale: [ 1, 1, 1 ] } );
const TOWER = {
	npc: { nav: {
		cellSize: 1, floors: [ { floor: 0 }, { floor: 1 }, { floor: 2 } ],
		connectors: [
			{ id: 'stair-a', kind: 'stair', floors: [ 0, 1 ], entryByFloor: { 0: [ 2, 1 ], 1: [ 2, 1 ] } },
			{ id: 'elev-0', kind: 'elevator', floors: [ 0, 1, 2 ], entryByFloor: { 0: [ 10, 1 ], 1: [ 10, 1 ], 2: [ 10, 1 ] } }
		]
	} },
	interior: {
		building: { floors: [
			{ index: 0, layout: 'ground', elevation: 0 },
			{ index: 1, layout: 'middle', elevation: 4, apartmentEntrances: [ { unit: 'f1-home-1', number: '101', position: [ 6, 3 ], inward: [ 0, 1 ], width: 1.6 } ] },
			{ index: 2, layout: 'top', elevation: 8 }
		] },
		layouts: {
			ground: {
				floor: { rooms: [ { id: 'f0-lobby', kind: 'lobby', polygon: [ [ 0, 0 ], [ 12, 0 ], [ 12, 6 ], [ 0, 6 ] ] }, { id: 'elev-0', kind: 'corridor', polygon: [ [ 9, 2 ], [ 11, 2 ], [ 11, 4 ], [ 9, 4 ] ] } ] },
				placements: [ flight( 'f0-s1', 0, 0, 1, 2 ), flight( 'f0-s2', 2, Math.PI, 3, 6 ) ]
			},
			middle: { floor: { rooms: [ { id: 'f1-corridor', kind: 'corridor', polygon: [ [ 0, 0 ], [ 12, 0 ], [ 12, 2 ], [ 0, 2 ] ] }, { id: 'f1-r1', kind: 'living', unit: 'f1-home-1', polygon: [ [ 4, 3 ], [ 8, 3 ], [ 8, 7 ], [ 4, 7 ] ] } ] }, placements: [] },
			top: { floor: { rooms: [ { id: 'f2-corridor', kind: 'corridor', polygon: [ [ 0, 0 ], [ 12, 0 ], [ 12, 2 ], [ 0, 2 ] ] } ] }, placements: [] }
		}
	}
};

/** How far along a path its point at `index` lies. */
function distanceTo( path, index ) {

	let total = 0;
	for ( let step = 1; step <= index; step ++ ) total += Math.hypot( ...path[ step ].map( ( value, axis ) => value - path[ step - 1 ][ axis ] ) );
	return total;

}
