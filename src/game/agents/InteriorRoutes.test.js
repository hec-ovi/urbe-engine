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

} );

function buildings() {

	return new Map( [
		[ 'p1', { npc: { nav: NAV }, interior: { building: { floors: [ { index: 1, elevation: 4.5 }, { index: 0, elevation: 1 } ] } } } ],
		[ 'p2', { npc: null, interior: null } ]
	] );

}
