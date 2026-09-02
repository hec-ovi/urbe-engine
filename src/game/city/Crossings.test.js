import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Crossings } from './Crossings.js';

/**
 * The blueprint has carried `streets.crossings` all along and the street was
 * unpainted. Four promises make the paint worth the draw: a city that marks no
 * crossing pays nothing, a marked one is painted across the roadway between its
 * two kerbs and nowhere else, the whole city is one draw, and the paint is lit
 * by the street rather than lighting it.
 */
describe( 'Crossings', () => {

	const segment = { from: [ 10, 20 ], to: [ 10, 32 ] };
	const city = ( crossings ) => ( { streets: { crossings } } );

	it( 'paints nothing for a city that marks no crossing', () => {

		expect( new Crossings( city( [] ) ).build().children ).toEqual( [] );
		expect( new Crossings( { streets: {} } ).build().children ).toEqual( [] );

	} );

	it( 'lays bars along the walk, across the corridor, clear of both kerbs', () => {

		const group = new Crossings( city( [ { nodeId: 'n0', segments: [ segment ] } ] ) ).build();
		const position = group.children[ 0 ].geometry.getAttribute( 'position' );
		const box = extent( position );

		// The segment runs 12 m up +z between the kerbs; the paint stops 0.3 m
		// short of each, and spreads 3.15 m across the road (four 0.45 m bars,
		// 0.45 m apart).
		expect( box.z ).toEqual( [ 20.3, 31.7 ] );
		expect( box.x[ 1 ] - box.x[ 0 ] ).toBeCloseTo( 3.15, 6 );
		expect( box.y ).toEqual( [ 0.012, 0.012 ] );

	} );

	it( 'draws every crossing in the city once', () => {

		const blueprint = JSON.parse( readFileSync(
			fileURLToPath( new URL( '../../../out/small/blueprint.json', import.meta.url ) ), 'utf8'
		) );
		const group = new Crossings( blueprint ).build();
		const segments = blueprint.streets.crossings.reduce( ( total, c ) => total + c.segments.length, 0 );

		expect( segments ).toBeGreaterThan( 20 );
		expect( group.children ).toHaveLength( 1 );
		// Four bars a segment, two triangles a bar, three vertices a triangle.
		expect( group.children[ 0 ].geometry.getAttribute( 'position' ).count ).toBe( segments * 4 * 6 );

	} );

	it( 'wears paint the street lights, not paint that lights the street', () => {

		const group = new Crossings( city( [ { nodeId: 'n0', segments: [ segment ] } ] ) ).build();
		const material = group.children[ 0 ].material;

		expect( material.emissive.getHex() ).toBe( 0x000000 );
		expect( material.toneMapped ).toBe( true );

	} );

} );

function extent( position ) {

	const box = { x: [ Infinity, - Infinity ], y: [ Infinity, - Infinity ], z: [ Infinity, - Infinity ] };

	for ( let i = 0; i < position.count; i ++ ) {

		for ( const [ axis, value ] of [ [ 'x', position.getX( i ) ], [ 'y', position.getY( i ) ], [ 'z', position.getZ( i ) ] ] ) {

			box[ axis ][ 0 ] = Math.min( box[ axis ][ 0 ], round( value ) );
			box[ axis ][ 1 ] = Math.max( box[ axis ][ 1 ], round( value ) );

		}

	}

	return box;

}

const round = ( value ) => Math.round( value * 1e4 ) / 1e4;
