import { describe, expect, it } from 'vitest';
import { ObjectiveRouter } from './ObjectiveRouter.js';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

describe( 'ObjectiveRouter', () => {

	it( 'routes the current feet to the exact parcel, station and stop destination over path3', () => {

		const router = new ObjectiveRouter( network() );
		const route = router.route( { from: [ - 1, 0, 0 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( route.nodeIds ).toEqual( [ 'a', 'b', 'entry-p9' ] );
		expect( route.edgeIds ).toEqual( [ 'short', 'access' ] );
		expect( route.path3 ).toEqual( [ [ - 1, 0, 0 ], [ 0, 0, 0 ], [ 5, 2, 0 ], [ 10, 2, 0 ] ] );
		expect( route.distanceMeters ).toBeCloseTo( 1 + Math.hypot( 5, 2 ) + 5 );

		const rerouted = router.route( { from: [ 10, 2, 1 ], destination: { kind: 'parcel', id: 'p9' } } );
		expect( rerouted.edgeIds ).toEqual( [] );
		expect( rerouted.path3 ).toEqual( [ [ 10, 2, 1 ], [ 10, 2, 0 ] ] );

		expect( router.route( { from: [ 0, 0, 0 ], destination: { kind: 'station', id: 'rail-a' } } ).nodeIds.at( - 1 ) ).toBe( 'station' );
		expect( router.route( { from: [ 0, 0, 0 ], destination: { kind: 'stop', id: 'bus-a' } } ).nodeIds.at( - 1 ) ).toBe( 'stop' );

	} );

	it( 'carries a parcel route from its entry node on to the door the city gave it', () => {

		const router = new ObjectiveRouter( network(), { places: [ { parcelId: 'p9', door: [ 12, 2, 0 ] } ] } );
		const route = router.route( { from: [ 10, 2, 1 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( route.nodeIds ).toEqual( [ 'entry-p9' ] );
		expect( route.path3 ).toEqual( [ [ 10, 2, 1 ], [ 10, 2, 0 ], [ 12, 2, 0 ] ] );
		expect( route.distanceMeters ).toBe( 3 );

		// A parcel with no door, and every station and stop, still ends at its node.
		expect( router.route( { from: [ 0, 0, 0 ], destination: { kind: 'stop', id: 'bus-a' } } ).path3.at( - 1 ) ).toEqual( [ 0, 0, 3 ] );
		expect( () => new ObjectiveRouter( network(), { places: [ { parcelId: 'p9', door: [ 12, 2 ] } ] } ) )
			.toThrowError( expect.objectContaining( { code: 'E_OBJECTIVE_ROUTE_INPUT' } ) );

	} );

	it( 'chooses the cheapest reachable entrance when a station has several destinations', () => {

		const graph = network();
		graph.nodes.push( node( 'aaa-isolated', 0, 0, 2, 'station', 'rail-a' ), node( 'zzz-near', 0, 0, 4, 'station', 'rail-a' ) );
		graph.edges.push( edge( 'near-access', 'a', 'zzz-near', [ [ 0, 0, 0 ], [ 0, 0, 4 ] ] ) );
		const route = new ObjectiveRouter( graph ).route( { from: [ 0, 0, 0 ], destination: { kind: 'station', id: 'rail-a' } } );

		expect( route.nodeIds ).toEqual( [ 'a', 'zzz-near' ] );
		expect( route.distanceMeters ).toBe( 4 );

	} );

	it( 'leads the feet past a skybridge the walk graph does not join, to the nearest node it does', () => {

		const graph = network();
		// A building link overhead: its portals stand inside the buildings, off the pavement.
		graph.nodes.push( node( 'portal-a', - 1, 1, 0, 'link-portal', 'l1' ), node( 'portal-b', - 1, 1, 8, 'link-portal', 'l1' ) );
		graph.edges.push( edge( 'bridge', 'portal-a', 'portal-b', [ [ - 1, 1, 0 ], [ - 1, 1, 8 ] ], 'link' ) );
		const route = new ObjectiveRouter( graph ).route( { from: [ - 1.5, 0.5, 0 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( route.nodeIds ).toEqual( [ 'a', 'b', 'entry-p9' ] );
		expect( route.path3[ 0 ] ).toEqual( [ - 1.5, 0.5, 0 ] );

	} );

	it( 'fails closed for off-contract, invalid, missing, and disconnected data', () => {

		expect( () => new ObjectiveRouter( { nodes: [], edges: [ { id: 'bad' } ] } ) ).toThrowError( ObjectiveRouteError );
		const router = new ObjectiveRouter( network() );
		expect( () => router.route( { from: [ 0, 0 ], destination: { kind: 'parcel', id: 'p9' } } ) )
			.toThrowError( expect.objectContaining( { code: 'E_OBJECTIVE_ROUTE_INPUT' } ) );
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
