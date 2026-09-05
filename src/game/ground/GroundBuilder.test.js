import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder, SIDEWALK_HEIGHT } from './GroundBuilder.js';

const factory = { build: ( key, variantId ) => {

	const material = new THREE.MeshStandardMaterial();
	material.userData = { key, variantId };
	return material;

} };
const ground = ( covers, transit ) => new GroundBuilder( { volumetric: { ground: covers }, transit }, factory ).build();
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

	it( 'lays the published kerb strip at pavement height', () => {

		const { group } = ground( [ ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) ] );
		const strip = group.getObjectByName( 'ground:curb' );

		expect( strip ).toBeDefined();
		expect( span( strip.geometry ) ).toEqual( [ SIDEWALK_HEIGHT + 0.004, SIDEWALK_HEIGHT + 0.004 ] );

	} );

	it( 'maps the published kerb top along its edge and across its width', () => {

		const vertical = ( surface, x0, x1 ) => ( {
			surface,
			polygon: [ [ x0, 0 ], [ x1, 0 ], [ x1, 20 ], [ x0, 20 ] ]
		} );
		const { group } = ground( [
			vertical( 'roadway', 0, 10 ),
			vertical( 'curb', 10, 10.15 ),
			vertical( 'sidewalk', 10.15, 16 )
		] );
		const uv = group.getObjectByName( 'ground:curb' ).geometry.getAttribute( 'uv' );
		const u = Array.from( { length: uv.count }, ( _, i ) => uv.getX( i ) );
		const v = Array.from( { length: uv.count }, ( _, i ) => uv.getY( i ) );

		// The material's 2 x .15 m tile runs along the stone, then across it.
		// World-axis fill UVs invert these spans when the kerb turns north.
		expect( round( Math.max( ...u ) - Math.min( ...u ) ) ).toBe( 20 );
		expect( round( Math.max( ...v ) - Math.min( ...v ) ) ).toBe( 0.15 );

	} );

	it( 'stands the strip on a face down to the roadway, and nothing else', () => {

		const { group } = ground( [ ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) ] );
		const kerb = group.getObjectByName( 'ground:kerb' );

		// Two triangles: the one edge of the strip with road on the other side.
		expect( kerb.geometry.getAttribute( 'position' ).count ).toBe( 6 );
		expect( span( kerb.geometry ) ).toEqual( [ - 0.06, SIDEWALK_HEIGHT + 0.004 ] );

	} );

	it( 'still cuts a kerb from the pavement in a world published without a strip', () => {

		const { group } = ground( [ ROAD, rect( 'sidewalk', 10, 16 ) ] );
		const kerb = group.getObjectByName( 'ground:kerb' );

		expect( group.getObjectByName( 'ground:curb' ) ).toBeUndefined();
		// The same face, and the stone's top band along it.
		expect( kerb.geometry.getAttribute( 'position' ).count ).toBe( 12 );
		expect( span( kerb.geometry ) ).toEqual( [ - 0.06, SIDEWALK_HEIGHT + 0.004 ] );

	} );

	it( 'opens the floor over every station shaft', () => {

		const footprint = [ [ 8, 12 ], [ 12, 12 ], [ 12, 14 ], [ 8, 14 ] ];
		const covers = [ ROAD, rect( 'sidewalk', 10, 16 ) ];
		const station = {
			subwayStations: [ {
				id: 'ss0', box: { bottom: - 12, top: - 7 }, level: - 12, entrances: [],
				platform: [ [ 0, 12 ], [ 20, 12 ], [ 20, 14 ], [ 0, 14 ] ],
				shafts: [ { footprint, top: 0, bottom: - 12, passage: [] } ]
			} ]
		};

		const sealed = ground( covers ).group.getObjectByName( 'ground:sidewalk' );
		const open = ground( covers, station ).group.getObjectByName( 'ground:sidewalk' );

		expect( covered( sealed.geometry, 10, 13 ) ).toBe( true );
		expect( covered( open.geometry, 10, 13 ) ).toBe( false );
		// Still floor either side of the mouth.
		expect( covered( open.geometry, 4, 13 ) ).toBe( true );
		expect( covered( open.geometry, 16, 13 ) ).toBe( true );


	} );

	it( 'includes Atlas highway decks and supports in the visible and solid ground', () => {

		const highwayStructures = [ {
			edgeIds: [ 'e0' ], path: [ [ 0, 5 ], [ 20, 5 ] ], width: 6, level: 8,
			deckThickness: 1, ramps: { start: 0, end: 0 },
			elevationProfile: [ { distance: 0, level: 8 }, { distance: 20, level: 8 } ],
			supports: [ {
				position: [ 10, 5 ], footprint: [ [ 9, 4 ], [ 11, 4 ], [ 11, 6 ], [ 9, 6 ] ],
				bottom: 0, top: 7
			} ]
		} ];
		const built = new GroundBuilder( {
			volumetric: { ground: [ ROAD ] }, streets: { highwayStructures }
		}, factory ).build();

		expect( built.group.getObjectByName( 'highway:roadway' ) ).toBeDefined();
		expect( built.group.getObjectByName( 'highway:structure' ) ).toBeDefined();
		expect( span( built.colliderGeometry )[ 1 ] ).toBe( 8 );

	} );

	it( 'uses neutral large plates and dry patched asphalt on the world-metre grid', () => {

		const shifted = ( surface, z0, z1 ) => ( {
			surface,
			polygon: [ [ 100, z0 ], [ 120, z0 ], [ 120, z1 ], [ 100, z1 ] ]
		} );
		const { group } = ground( [
			shifted( 'roadway', 200, 210 ),
			shifted( 'curb', 210, 210.15 ),
			shifted( 'sidewalk', 210.15, 216 ),
			shifted( 'block', 216, 220 ),
			shifted( 'open', 220, 224 )
		] );

		const road = group.getObjectByName( 'ground:roadway' );
		expect( road.material.userData ).toEqual( {
			key: 'cyberpunk/street-road/mid', variantId: 'maintained'
		} );

		for ( const name of [ 'sidewalk', 'block', 'open' ] ) {

			const surface = group.getObjectByName( `ground:${name}` );
			expect( surface.material.userData ).toEqual( {
				key: 'cyberpunk/street-paving/mid', variantId: 'maintained'
			} );
			expect( worldUvErrors( surface.geometry ) ).toEqual( [] );

		}

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

/** Horizontal cover UVs are absolute world metres: [x, -z]. */
function worldUvErrors( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const uv = geometry.getAttribute( 'uv' );
	const errors = [];

	for ( let i = 0; i < position.count; i ++ ) {

		if ( Math.abs( uv.getX( i ) - position.getX( i ) ) > 1e-6
			|| Math.abs( uv.getY( i ) + position.getZ( i ) ) > 1e-6 ) errors.push( i );

	}

	return errors;

}
