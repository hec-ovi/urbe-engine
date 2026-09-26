import { describe, expect, it } from 'vitest';
import { WalkRoutes } from './WalkRoutes.js';

describe( 'walk routes', () => {

	it( 'keeps station and building-link edges connected at their exact height', () => {

		const routes = new WalkRoutes( network() );

		expect( [ ...routes.edges.values() ].map( ( edge ) => edge.kind ) ).toEqual( [
			'sidewalk', 'access', 'stairs', 'passage', 'platform', 'link'
		] );
		expect( routes.pointAt( routes.edges.get( 'stairs' ), 5, 1 ).y ).toBeLessThan( 0 );
		expect( routes.pointAt( routes.edges.get( 'platform' ), 2, 1 ).y ).toBe( - 12 );
		expect( routes.pointAt( routes.edges.get( 'link' ), 2, 1 ).y ).toBeGreaterThan( 20 );
		expect( routes.near( { x: 1, z: 0 }, 0, 5 ).some( ( edge ) => edge.id === 'link' ) ).toBe( true );

	} );

	it( 'refuses a compatibility-only walk edge', () => {

		const input = network();
		delete input.walk.edges[ 0 ].path3;

		expect( () => new WalkRoutes( input ) ).toThrow( /E_MOVEMENT_PATH3: walk edge sidewalk\.path3/ );

	} );

	it( 'projects onto the same nearest segment as a scan of every edge, inside and outside the network', () => {

		const input = jitteredGrid( 9, 7, 23 );
		const routes = new WalkRoutes( input );
		const random = seeded( 5 );
		for ( let index = 0; index < 400; index ++ ) {

			const point = [ random() * 400 - 100, random() * 12 - 4, random() * 320 - 80 ];
			const found = routes.project( point );
			const expected = scanProject( routes, point );
			expect( found.edge.id ).toBe( expected.edge.id );
			expect( found.point ).toEqual( expected.point );
			expect( found.gap ).toBe( expected.gap );
			expect( found.distance ).toBe( expected.distance );

		}

	} );

	it( 'routes over the shortest walk graph path', () => {

		const input = jitteredGrid( 9, 7, 23 );
		const routes = new WalkRoutes( input );
		const random = seeded( 11 );
		for ( let index = 0; index < 40; index ++ ) {

			const from = [ random() * 200, 1, random() * 150 ];
			const to = [ random() * 200, 1, random() * 150 ];
			const route = routes.route( from, to );
			expect( route.path3[ 0 ] ).toEqual( from );
			expect( route.path3.at( - 1 ) ).toEqual( to );
			const start = routes.project( from );
			const finish = routes.project( to );
			const graph = scanShortest( routes, start, finish );
			const lead = Math.hypot( ...from.map( ( value, axis ) => start.point[ axis ] - value ) ) +
				Math.hypot( ...to.map( ( value, axis ) => finish.point[ axis ] - value ) );
			expect( route.distanceMeters ).toBeCloseTo( graph + lead, 6 );

		}

	} );

} );

/** Nodes on a jittered grid joined by bent, sloped edges. */
function jitteredGrid( columns, rows, seed ) {

	const random = seeded( seed );
	const nodes = [];
	const edges = [];
	for ( let row = 0; row < rows; row ++ ) for ( let column = 0; column < columns; column ++ ) {

		nodes.push( {
			id: `n${row}-${column}`, kind: 'corner',
			x: column * 25 + ( row && column ? random() * 8 - 4 : 0 ), y: random() * 2, z: row * 25 + ( row && column ? random() * 8 - 4 : 0 )
		} );

	}
	const at = ( row, column ) => nodes[ row * columns + column ];
	const join = ( a, b ) => {

		const bend = [ ( a.x + b.x ) / 2 + random() * 4 - 2, ( a.y + b.y ) / 2 + random(), ( a.z + b.z ) / 2 + random() * 4 - 2 ];
		const path3 = [ [ a.x, a.y, a.z ], bend, [ b.x, b.y, b.z ] ];
		edges.push( { id: `e${edges.length.toString().padStart( 3, '0' )}`, from: a.id, to: b.id, kind: 'sidewalk', width: 2,
			path: path3.map( ( [ x, , z ] ) => [ x, z ] ), path3 } );

	};
	for ( let row = 0; row < rows; row ++ ) for ( let column = 0; column < columns; column ++ ) {

		if ( column + 1 < columns ) join( at( row, column ), at( row, column + 1 ) );
		if ( row + 1 < rows ) join( at( row, column ), at( row + 1, column ) );

	}
	return { walk: { nodes, edges } };

}

/** Every segment of every edge, nearest first, then lower edge id, then earlier segment. */
function scanProject( routes, point ) {

	let best = null;
	for ( const edge of routes.walkable ) {

		let before = 0;
		for ( let index = 1; index < edge.path.length; index ++ ) {

			const a = edge.path[ index - 1 ];
			const b = edge.path[ index ];
			const span = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] );
			const along = ( point[ 0 ] - a[ 0 ] ) * ( b[ 0 ] - a[ 0 ] ) + ( point[ 1 ] - a[ 1 ] ) * ( b[ 1 ] - a[ 1 ] ) + ( point[ 2 ] - a[ 2 ] ) * ( b[ 2 ] - a[ 2 ] );
			const t = span > 0 ? Math.max( 0, Math.min( 1, along / ( span * span ) ) ) : 0;
			const at = [ 0, 1, 2 ].map( ( axis ) => a[ axis ] + ( b[ axis ] - a[ axis ] ) * t );
			const gap = Math.hypot( point[ 0 ] - at[ 0 ], point[ 1 ] - at[ 1 ], point[ 2 ] - at[ 2 ] );
			if ( ! best || gap < best.gap - 1e-9 || ( Math.abs( gap - best.gap ) <= 1e-9 && edge.id < best.edge.id ) ) {

				best = { edge, point: at, gap, distance: before + span * t };

			}
			before += span;

		}

	}
	return best;

}

/** Shortest graph distance between two projections by exhaustive relaxation. */
function scanShortest( routes, start, finish ) {

	const distances = new Map( [ start.edge.from, start.edge.to ].map( ( id, end ) => [ id, end ? start.edge.length - start.distance : start.distance ] ) );
	for ( let changed = true; changed; ) {

		changed = false;
		for ( const edge of routes.edges.values() ) for ( const [ a, b ] of [ [ edge.from, edge.to ], [ edge.to, edge.from ] ] ) {

			const via = ( distances.get( a ) ?? Infinity ) + edge.length;
			if ( via < ( distances.get( b ) ?? Infinity ) - 1e-12 ) {

				distances.set( b, via );
				changed = true;

			}

		}

	}
	const through = Math.min(
		distances.get( finish.edge.from ) + finish.distance,
		distances.get( finish.edge.to ) + finish.edge.length - finish.distance
	);
	return start.edge.id === finish.edge.id ? Math.min( through, Math.abs( finish.distance - start.distance ) ) : through;

}

function seeded( seed ) {

	let state = seed >>> 0;
	return () => {

		state = ( state * 1664525 + 1013904223 ) >>> 0;
		return state / 4294967296;

	};

}

function network() {

	const points = [
		[ 0, 0, 0 ], [ 10, 0, 0 ], [ 12, 0, 0 ], [ 14, - 12, 0 ], [ 18, - 12, 0 ], [ 24, - 12, 0 ]
	];
	const nodes = points.map( ( [ x, y, z ], index ) => ( {
		id: `n${index}`, x, y, z, kind: index < 2 ? 'corner' : 'station-access'
	} ) );
	const make = ( id, from, to, kind, path3 ) => ( {
		id, from: `n${from}`, to: `n${to}`, kind, width: 2,
		path: path3.map( ( [ x, , z ] ) => [ x, z ] ), path3, level: Math.max( ...path3.map( ( p ) => p[ 1 ] ) )
	} );

	return { walk: { nodes, edges: [
		make( 'sidewalk', 0, 1, 'sidewalk', points.slice( 0, 2 ) ),
		make( 'access', 1, 2, 'access', points.slice( 1, 3 ) ),
		make( 'stairs', 2, 3, 'stairs', points.slice( 2, 4 ) ),
		make( 'passage', 3, 4, 'passage', points.slice( 3, 5 ) ),
		make( 'platform', 4, 5, 'platform', points.slice( 4, 6 ) ),
		make( 'link', 0, 1, 'link', [ [ 0, 24, 1 ], [ 10, 28, 1 ] ] )
	] } };

}
