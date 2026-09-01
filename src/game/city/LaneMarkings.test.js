import { describe, expect, it } from 'vitest';
import { LaneMarkings } from './LaneMarkings.js';

/**
 * Road paint has to land on the lane boundary rather than down the middle of
 * the lane, and it has to be broken where the neighbour runs the same way and
 * solid where it does not. Those two are the whole promise; the rest is
 * geometry.
 */
describe( 'LaneMarkings', () => {

	// Two lanes side by side heading +x, 3 m wide, lane b the same-way
	// neighbour on lane a's left. Left of +x is +z in the connections frame.
	const networks = {
		road: { lanes: [
			{ id: 'a', index: 0, width: 3, path: [ [ 0, 0 ], [ 30, 0 ] ], left: { laneId: 'b', change: true } },
			{ id: 'b', index: 1, width: 3, path: [ [ 0, 3 ], [ 30, 3 ] ] }
		] } }
	;

	it( 'paints each lane its own left boundary, broken only between same-way lanes', () => {

		const mesh = new LaneMarkings( networks ).build().children[ 0 ];
		const position = mesh.geometry.getAttribute( 'position' );
		const lines = new Map();

		for ( let i = 0; i < position.count; i ++ ) {

			const z = Math.round( position.getZ( i ) * 100 ) / 100;
			lines.set( z, ( lines.get( z ) ?? 0 ) + 1 );

		}

		const at = [ ...lines.keys() ].sort( ( x, y ) => x - y );

		// lane a's boundary with lane b at z = 1.5, and lane b's own left
		// boundary, inset by half the gap of a double centre line, at z = 4.41
		expect( at ).toEqual( [ 1.44, 1.56, 4.35, 4.47 ] );

		// the centre line runs unbroken: one quad, three vertices down each edge
		expect( lines.get( 4.47 ) ).toBe( 3 );

		// the lane line is dashed: 30 m of 3 m dash on a 9 m period is 4 dashes
		expect( lines.get( 1.56 ) ).toBe( 12 );

	} );

	it( 'faces every marking up at the sky', () => {

		for ( const mode of [ 'paint', 'glow', 'debug' ] ) {

			for ( const mesh of new LaneMarkings( networks, mode ).build().children ) {

				const p = mesh.geometry.getAttribute( 'position' );

				for ( let i = 0; i < p.count; i += 3 ) {

					// (b - a) x (c - a), y component only: the rest is zero on a
					// flat quad, and a negative one is paint under the asphalt.
					const y = ( p.getZ( i + 1 ) - p.getZ( i ) ) * ( p.getX( i + 2 ) - p.getX( i ) )
						- ( p.getX( i + 1 ) - p.getX( i ) ) * ( p.getZ( i + 2 ) - p.getZ( i ) );

					expect( y, `${mode} triangle ${i / 3}` ).toBeGreaterThan( 0 );

				}

			}

		}

	} );

	it( 'keeps the teal centreline strips behind the flag', () => {

		const paint = new LaneMarkings( networks ).build().children[ 0 ];
		const glow = new LaneMarkings( networks, 'glow' ).build().children[ 0 ];

		expect( glow.material.color.getHex() ).not.toBe( paint.material.color.getHex() );

		// the strips sit on the lane centrelines themselves, not the boundaries
		const z = glow.geometry.getAttribute( 'position' ).getZ( 0 );
		expect( Math.abs( z ) ).toBeLessThan( 0.05 );

	} );

} );
