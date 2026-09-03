import { describe, expect, it } from 'vitest';
import { ObjectiveRouter } from './ObjectiveRouter.js';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

describe( 'ObjectiveRouter', () => {

	it( 'routes from the current feet to the exact parcel entry over path3', () => {

		const router = new ObjectiveRouter( network() );
		const route = router.route( { from: [ - 1, 0, 0 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( route.nodeIds ).toEqual( [ 'a', 'b', 'entry-p9' ] );
		expect( route.edgeIds ).toEqual( [ 'short', 'access' ] );
		expect( route.path3 ).toEqual( [ [ - 1, 0, 0 ], [ 0, 0, 0 ], [ 5, 2, 0 ], [ 10, 2, 0 ] ] );
		expect( route.distanceMeters ).toBeCloseTo( 1 + Math.hypot( 5, 2 ) + 5 );

	} );

	it( 'reroutes deterministically from a changed position', () => {

		const router = new ObjectiveRouter( network() );
		const first = router.route( { from: [ 0, 0, 0 ], destination: { kind: 'parcel', id: 'p9' } } );
		const rerouted = router.route( { from: [ 10, 2, 1 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( first.edgeIds ).toEqual( [ 'short', 'access' ] );
		expect( rerouted.edgeIds ).toEqual( [] );
		expect( rerouted.path3 ).toEqual( [ [ 10, 2, 1 ], [ 10, 2, 0 ] ] );

	} );

	it( 'supports exact station and stop destinations', () => {

		const router = new ObjectiveRouter( network() );
		expect( router.route( { from: [ 0, 0, 0 ], destination: { kind: 'station', id: 'rail-a' } } ).nodeIds.at( - 1 ) ).toBe( 'station' );
		expect( router.route( { from: [ 0, 0, 0 ], destination: { kind: 'stop', id: 'bus-a' } } ).nodeIds.at( - 1 ) ).toBe( 'stop' );

	} );

	it( 'fails closed for invalid, missing, and disconnected data', () => {

		expect( () => new ObjectiveRouter( { nodes: [], edges: [ { id: 'bad' } ] } ) ).toThrowError( ObjectiveRouteError );
		const router = new ObjectiveRouter( network() );
		expect( () => router.route( { from: [ 0, 0, 0 ], destination: { kind: 'parcel', id: 'missing' } } ) )
			.toThrowError( /no parcel destination missing/ );
		expect( () => router.route( { from: [ 0, 0, 0 ], destination: { kind: 'parcel', id: 'p-island' } } ) )
			.toThrowError( /unreachable/ );

	} );

} );

function network() {

	const nodes = [
		node( 'a', 0, 0, 0, 'corner' ),
		node( 'b', 5, 2, 0, 'corner' ),
		node( 'entry-p9', 10, 2, 0, 'entry', 'p9' ),
		node( 'station', 5, - 8, 5, 'station', 'rail-a' ),
		node( 'stop', 0, 0, 3, 'stop', 'bus-a' ),
		node( 'island', 30, 0, 30, 'entry', 'p-island' )
	];
	const edges = [
		edge( 'long', 'a', 'entry-p9', [ [ 0, 0, 0 ], [ 0, 0, 9 ], [ 10, 2, 0 ] ] ),
		edge( 'short', 'a', 'b', [ [ 0, 0, 0 ], [ 5, 2, 0 ] ] ),
		edge( 'access', 'b', 'entry-p9', [ [ 5, 2, 0 ], [ 10, 2, 0 ] ], 'access' ),
		edge( 'platform', 'b', 'station', [ [ 5, 2, 0 ], [ 5, - 8, 5 ] ], 'stairs' ),
		edge( 'bus-access', 'a', 'stop', [ [ 0, 0, 0 ], [ 0, 0, 3 ] ] )
	];
	return { nodes, edges };

}

function node( id, x, y, z, kind, ref ) {

	return { id, x, y, z, kind, ...( ref ? { ref } : {} ) };

}

function edge( id, from, to, path3, kind = 'sidewalk' ) {

	return { id, from, to, kind, path3 };

}
