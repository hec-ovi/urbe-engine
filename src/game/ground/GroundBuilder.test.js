import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder, SIDEWALK_HEIGHT } from './GroundBuilder.js';

const factory = { build: ( key, variantId ) => {

	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;

} };
const ground = covers => new GroundBuilder( { volumetric: { ground: covers } }, factory ).build();
const rect = ( surface, z0, z1 ) => ( { surface, polygon: [ [ 0, z0 ], [ 20, z0 ], [ 20, z1 ], [ 0, z1 ] ] } );

const ROAD = rect( 'roadway', 0, 10 );
const STRIP = rect( 'curb', 10, 10.15 );

/**
 * The blueprint publishes its kerb strip as a ground surface, unbroken through
 * every junction return, which is something a pavement edge cannot be. Three
 * promises: the strip is laid rather than dropped on the floor of the surface
 * map, it stands as a real stone with a face down to the road, and a world
 * published before the strip existed still gets a kerb.
 */
describe( 'GroundBuilder', () => {

	it( 'preserves complete authored curb polygons and each cover elevation', () => {

		const curb = { surface: 'curb', bottom: - 0.2, top: 0.24,
			polygon: [ [ 0, 10 ], [ 20, 10 ], [ 20, 10.2 ], [ 19.8, 10.35 ], [ 0, 10.35 ] ] };
		const { group, colliderGeometry } = ground( [
			{ ...ROAD, bottom: - 0.4, top: - 0.03 }, curb,
			{ ...rect( 'sidewalk', 10.35, 16 ), bottom: 0, top: 0.24 },
			{ ...rect( 'sidewalk', 16, 20 ), bottom: 0, top: 0.32 }
		] );
		const top = group.getObjectByName( 'ground:curb' ).geometry;
		expect( span( top ) ).toEqual( [ 0.24, 0.24 ] );
		expect( horizontalArea( top ) ).toBeCloseTo( 6.985, 4 );
		expect( covered( top, 10, 10.3 ) ).toBe( true );
		expect( covered( top, 19.99, 10.34 ) ).toBe( false );
		expect( span( group.getObjectByName( 'ground:roadway' ).geometry ) ).toEqual( [ - 0.03, - 0.03 ] );
		expect( span( group.getObjectByName( 'ground:sidewalk' ).geometry ) ).toEqual( [ 0.24, 0.32 ] );
		expect( span( colliderGeometry ) ).toEqual( [ - 0.2, 0.32 ] );

	} );

	it( 'selects reproducible complete material families from the city seed', () => {

		const variants = new Set();
		for ( const seed of [ '0', '1', '2' ] ) {
			const atlas = { meta: { seed }, volumetric: { ground: [ ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) ] } };
			const build = () => new GroundBuilder( atlas, factory ).build().group.children
				.filter( object => object.isMesh ).map( object => object.material.userData );
			const selected = build();
			expect( build() ).toEqual( selected );
			expect( new Set( selected.map( material => material.variantId ) ).size ).toBe( 1 );
			variants.add( selected[ 0 ].variantId );
		}
		expect( variants ).toEqual( new Set( [ 'maintained', 'salvaged', 'industrial' ] ) );

	} );

	it( 'lays the published kerb strip, and cuts one from the pavement where a world has none', () => {

		const strip = ground( [ ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) ] ).group.getObjectByName( 'ground:curb' );
		expect( span( strip.geometry ) ).toEqual( [ SIDEWALK_HEIGHT + 0.004, SIDEWALK_HEIGHT + 0.004 ] );

		const legacy = ground( [ ROAD, rect( 'sidewalk', 10, 16 ) ] ).group;
		expect( legacy.getObjectByName( 'ground:curb' ) ).toBeUndefined();
		// The same face, and the stone's top band along it.
		expect( legacy.getObjectByName( 'ground:kerb' ).geometry.getAttribute( 'position' ).count ).toBe( 12 );
		expect( span( legacy.getObjectByName( 'ground:kerb' ).geometry ) ).toEqual( [ - 0.06, SIDEWALK_HEIGHT + 0.004 ] );

	} );

} );

function horizontalArea( geometry ) {

	const p = geometry.getAttribute( 'position' );
	let area = 0;
	for ( let i = 0; i < ( geometry.index?.count ?? p.count ); i += 3 ) {
		const [ a, b, c ] = [ 0, 1, 2 ].map( j => geometry.index ? geometry.index.getX( i + j ) : i + j );
		area += Math.abs( ( p.getX( b ) - p.getX( a ) ) * ( p.getZ( c ) - p.getZ( a ) )
			- ( p.getZ( b ) - p.getZ( a ) ) * ( p.getX( c ) - p.getX( a ) ) ) / 2;
	}
	return area;

}

/** Whether any triangle of a horizontal fill covers the point. */
function covered( geometry, x, z ) {

	const position = geometry.getAttribute( 'position' );
	const index = geometry.index;
	const count = index ? index.count : position.count;
	const at = ( i ) => {

		const v = index ? index.getX( i ) : i;

		return [ position.getX( v ), position.getZ( v ) ];

	};

	for ( let i = 0; i < count; i += 3 ) {

		if ( inTriangle( x, z, at( i ), at( i + 1 ), at( i + 2 ) ) ) return true;

	}

	return false;

}

function inTriangle( x, z, a, b, c ) {

	const side = ( p, q ) => ( q[ 0 ] - p[ 0 ] ) * ( z - p[ 1 ] ) - ( q[ 1 ] - p[ 1 ] ) * ( x - p[ 0 ] );
	const s = [ side( a, b ), side( b, c ), side( c, a ) ];

	return s.every( ( v ) => v >= 0 ) || s.every( ( v ) => v <= 0 );

}

/** The y range a geometry occupies, rounded to the millimetre. */
function span( geometry ) {

	const position = geometry.getAttribute( 'position' );
	let low = Infinity;
	let high = - Infinity;

	for ( let i = 0; i < position.count; i ++ ) {

		low = Math.min( low, position.getY( i ) );
		high = Math.max( high, position.getY( i ) );

	}

	return [ round( low ), round( high ) ];

}

const round = ( value ) => Math.round( value * 1e4 ) / 1e4;
