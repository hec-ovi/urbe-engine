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

describe( 'the shortest route over a large walk graph', () => {

	/** The route the open set sorted whole at every step gives: nearest first, then the id that sorts first. */
	function reference( router, from, destination ) {

		const start = router.route( { from, destination } ).nodeIds[ 0 ];
		const ends = new Set( [ ...router.nodes.values() ].filter( ( one ) => one.kind === 'entry' && one.ref === destination.id ).map( ( one ) => one.id ) );
		const distance = new Map( [ [ start, 0 ] ] );
		const previous = new Map();
		const open = new Set( [ start ] );
		const settled = new Set();
		while ( open.size ) {

			const current = [ ...open ].sort( ( a, b ) => ( distance.get( a ) - distance.get( b ) ) || a.localeCompare( b ) )[ 0 ];
			open.delete( current );
			if ( settled.has( current ) ) continue;
			settled.add( current );
			if ( ends.has( current ) ) break;
			for ( const leg of router.adjacency.get( current ) ) {

				if ( settled.has( leg.to ) ) continue;
				const candidate = distance.get( current ) + leg.edge.distance;
				const known = distance.get( leg.to ) ?? Infinity;
				const knownPrevious = previous.get( leg.to );
				if ( candidate > known + 1e-9 ) continue;
				if ( Math.abs( candidate - known ) <= 1e-9 && knownPrevious && ( leg.edge.id.localeCompare( knownPrevious.edge.id ) || leg.to.localeCompare( knownPrevious.to ) ) >= 0 ) continue;
				distance.set( leg.to, candidate );
				previous.set( leg.to, { ...leg, from: current } );
				open.add( leg.to );

			}

		}
		return distance;

	}

	/** A street grid of `size` by `size` corners 10 m apart, every block's corner an entry, with many routes of equal length. */
	function grid( size ) {

		const nodes = [];
		const edges = [];
		const id = ( i, j ) => `n${i}-${j}`;
		for ( let i = 0; i < size; i ++ ) for ( let j = 0; j < size; j ++ ) {

			nodes.push( node( id( i, j ), i * 10, 0, j * 10, ( i + j ) % 7 === 3 ? 'entry' : 'corner', ( i + j ) % 7 === 3 ? `p${i}-${j}` : undefined ) );
			if ( i ) edges.push( edge( `x${i}-${j}`, id( i - 1, j ), id( i, j ), [ [ i * 10 - 10, 0, j * 10 ], [ i * 10, 0, j * 10 ] ] ) );
			if ( j ) edges.push( edge( `z${i}-${j}`, id( i, j - 1 ), id( i, j ), [ [ i * 10, 0, j * 10 - 10 ], [ i * 10, 0, j * 10 ] ] ) );

		}
		return { nodes, edges };

	}

	it( 'settles the walk graph in the order a whole sort of the open nodes would, ties included', () => {

		const router = new ObjectiveRouter( grid( 24 ) );
		for ( const [ from, to ] of [ [ [ 0, 0, 0 ], 'p23-22' ], [ [ 115, 0, 3 ], 'p0-3' ], [ [ 230, 0, 230 ], 'p1-2' ], [ [ 51, 0, 49 ], 'p12-12' ] ] ) {

			const route = router.route( { from, destination: { kind: 'parcel', id: to } } );
			const distance = reference( router, from, { kind: 'parcel', id: to } );
			const end = route.nodeIds.at( - 1 );
			expect( route.distanceMeters - Math.hypot( from[ 0 ] - router.nodes.get( route.nodeIds[ 0 ] ).x, from[ 2 ] - router.nodes.get( route.nodeIds[ 0 ] ).z ) ).toBeCloseTo( distance.get( end ), 9 );
			// Among the many equal grid routes, the same one every time: each leg the first by edge id.
			expect( router.route( { from, destination: { kind: 'parcel', id: to } } ).edgeIds ).toEqual( route.edgeIds );

		}

	} );

} );
