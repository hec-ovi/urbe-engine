import { describe, expect, it } from 'vitest';
import { ledge, skirt } from './Polygons.js';

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

} );
