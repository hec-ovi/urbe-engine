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

	it( 'can route from the street through a station sequence', () => {

		const routes = new WalkRoutes( network() );
		const rng = () => 0;
		let edge = routes.edges.get( 'sidewalk' );
		let direction = 1;
		const walked = [ edge.kind ];

		for ( let step = 0; step < 4; step ++ ) {

			const next = routes.nextFrom( routes.exitNode( edge, direction ), edge.id, rng );
			edge = next.edge;
			direction = next.direction;
			walked.push( edge.kind );

		}

		expect( walked ).toEqual( [ 'sidewalk', 'access', 'stairs', 'passage', 'platform' ] );

	} );

	it( 'refuses a compatibility-only walk edge', () => {

		const input = network();
		delete input.walk.edges[ 0 ].path3;

		expect( () => new WalkRoutes( input ) ).toThrow( /E_MOVEMENT_PATH3: walk edge sidewalk\.path3/ );

	} );

} );

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
