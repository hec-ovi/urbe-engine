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

} );

function buildings() {

	return new Map( [
		[ 'p1', { npc: { nav: NAV }, interior: { building: { floors: [ { index: 1, elevation: 4.5 }, { index: 0, elevation: 1 } ] } } } ],
		[ 'p2', { npc: null, interior: null } ]
	] );

}
