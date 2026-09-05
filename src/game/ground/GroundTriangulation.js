import * as THREE from 'three/webgpu';
import { EncodedRing } from './EncodedRing.js';

/** Retains every encoded station; null leaves unrepresentable rings to the caller. */
export function groundTriangles( polygon ) {

	const ring = new EncodedRing( polygon );
	if ( ! ring.isSimple() ) return null;
	const n = polygon.length;
	const corners = Array.from( { length: n }, ( _, i ) => i ).filter( i => ring.turn( ( i + n - 1 ) % n, i, ( i + 1 ) % n ) !== 0n );
	const triangles = triangulate( corners.map( i => ring.points[ i ] ) ).map( triangle => triangle.map( i => corners[ i ] ) );
	for ( let i = 0; i < corners.length; i ++ ) {

		const start = corners[ i ], end = corners[ ( i + 1 ) % corners.length ];
		if ( ( start + 1 ) % n === end ) continue;
		const chain = [ start ];
		for ( let j = ( start + 1 ) % n; j !== end; j = ( j + 1 ) % n ) chain.push( j );
		chain.push( end );
		insertStations( triangles, chain );

	}
	if ( triangles.length !== n - 2 || triangles.some( triangle => ring.turn( ...triangle ) >= 0n ) ) fail( 'Encoded ground triangulation is incomplete' );
	return triangles;

}

function triangulate( points ) {

	return THREE.ShapeUtils.triangulateShape( points.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ), [] );

}

/** Subdivide a boundary triangle along its collinear authored stations. */
function insertStations( triangles, chain ) {

	const first = chain[ 0 ], last = chain.at( - 1 );
	const index = triangles.findIndex( triangle => triangle.includes( first ) && triangle.includes( last ) );
	if ( index < 0 ) fail( 'Encoded ground triangulation has no boundary edge' );
	const triangle = triangles[ index ];
	if ( triangle[ ( triangle.indexOf( first ) + 1 ) % 3 ] !== last ) chain.reverse();
	const opposite = triangle.find( vertex => vertex !== first && vertex !== last );
	const pieces = chain.slice( 1 ).map( ( vertex, i ) => [ chain[ i ], vertex, opposite ] );
	triangles.splice( index, 1, ...pieces );

}

function fail( message ) {

	throw Object.assign( new Error( message ), { code: 'E_GROUND_TRIANGULATION' } );

}
