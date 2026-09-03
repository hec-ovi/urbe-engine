import { describe, expect, it } from 'vitest';
import { ledge, skirt, Roadway } from './Polygons.js';

const square = [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ];

/**
 * A sidewalk edge is a kerb: a stone top a hand wide and a face down to the
 * road. Without the top the step reads as a crack between two surfaces.
 */
describe( 'kerb geometry', () => {

	it( 'lays a ledge of the given width just inside the ring, mitred at the corners', () => {

		const top = ledge( square, 0.15, 0.15 );
		const position = top.getAttribute( 'position' );
		let minX = Infinity, maxX = - Infinity;

		for ( let i = 0; i < position.count; i ++ ) {

			expect( position.getY( i ) ).toBeCloseTo( 0.15 );
			minX = Math.min( minX, position.getX( i ) );
			maxX = Math.max( maxX, position.getX( i ) );

		}

		// Four edges, two triangles each; the inner corners sit exactly one width in.
		expect( position.count ).toBe( 24 );
		expect( minX ).toBeCloseTo( 0 );
		expect( maxX ).toBeCloseTo( 10 );
		const xs = new Set();
		for ( let i = 0; i < position.count; i ++ ) xs.add( position.getX( i ).toFixed( 3 ) );
		expect( xs.has( '0.150' ) ).toBe( true );
		expect( xs.has( '9.850' ) ).toBe( true );

	} );

	it( 'drops the face from the pavement to the road all the way round', () => {

		const face = skirt( square, 0.15, - 0.05 );

		expect( face.getAttribute( 'position' ).count ).toBe( 24 );

	} );

	it( 'anchors straight-run joints in world metres regardless of ring origin or winding', () => {

		const ring = [ [ 101, 200 ], [ 111, 200 ], [ 111, 210 ], [ 101, 210 ] ];
		const keepSouth = ( a, b ) => a[ 1 ] === 200 && b[ 1 ] === 200;
		const forward = skirt( ring, 0.15, - 0.05, keepSouth ).getAttribute( 'uv' );
		const reversed = skirt( [ ...ring ].reverse(), 0.15, - 0.05,
			( a, b ) => a[ 1 ] === 200 && b[ 1 ] === 200 ).getAttribute( 'uv' );
		const top = ledge( ring, 0.15, 0.2, keepSouth ).getAttribute( 'uv' );
		const reversedTop = ledge( [ ...ring ].reverse(), 0.15, 0.2,
			( a, b ) => a[ 1 ] === 200 && b[ 1 ] === 200 ).getAttribute( 'uv' );

		expect( extent( forward, 'x' ) ).toEqual( [ 101, 111 ] );
		expect( extent( reversed, 'x' ) ).toEqual( [ 101, 111 ] );
		expect( extent( top, 'x' ) ).toEqual( [ 101, 111 ] );
		expect( extent( reversedTop, 'x' ) ).toEqual( [ 101, 111 ] );

	} );

} );

function extent( attribute, component ) {

	const get = component === 'x' ? ( i ) => attribute.getX( i ) : ( i ) => attribute.getY( i );
	let min = Infinity;
	let max = - Infinity;

	for ( let i = 0; i < attribute.count; i ++ ) {

		min = Math.min( min, get( i ) );
		max = Math.max( max, get( i ) );

	}

	return [ min, max ];

}

/**
 * A kerb stands where the pavement meets the road and nowhere else: not along
 * a building, not between two pavements.
 */
describe( 'kerb placement', () => {

	// The road runs along the square's south edge (z < 0), nothing else around it.
	const road = new Roadway( [ { surface: 'roadway', polygon: [ [ - 5, - 8 ], [ 15, - 8 ], [ 15, 0 ], [ - 5, 0 ] ] } ] );
	const onRoad = ( a, b ) => road.bordersEdge( a, b, true );

	it( 'keeps the stone on the edge that borders the road only', () => {

		expect( ledge( square, 0.15, 0.15, onRoad ).getAttribute( 'position' ).count ).toBe( 6 );
		expect( skirt( square, 0.15, - 0.05, onRoad ).getAttribute( 'position' ).count ).toBe( 6 );

	} );

	it( 'ends the stone square where its neighbours are not kerbs', () => {

		const position = ledge( square, 0.15, 0.15, onRoad ).getAttribute( 'position' );
		const xs = new Set();
		for ( let i = 0; i < position.count; i ++ ) xs.add( position.getX( i ).toFixed( 2 ) );

		expect( xs.has( '0.00' ) && xs.has( '10.00' ) ).toBe( true );
		expect( xs.has( '0.15' ) || xs.has( '9.85' ) ).toBe( false );

	} );

} );
