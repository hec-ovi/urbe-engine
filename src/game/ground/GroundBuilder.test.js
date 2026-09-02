import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder, SIDEWALK_HEIGHT } from './GroundBuilder.js';

const factory = { build: () => new THREE.MeshStandardMaterial() };
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

	it( 'lays the published kerb strip at pavement height', () => {

		const { group } = ground( [ ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) ] );
		const strip = group.getObjectByName( 'ground:curb' );

		expect( strip ).toBeDefined();
		expect( span( strip.geometry ) ).toEqual( [ SIDEWALK_HEIGHT + 0.004, SIDEWALK_HEIGHT + 0.004 ] );

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

	it( 'opens the floor over every station shaft and puts the bedrock under it', () => {

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

		expect( bedrockY( ground( covers ).group ) ).toBe( - 0.8 );
		expect( bedrockY( ground( covers, station ).group ) ).toBe( - 14 );

	} );

} );

const bedrockY = ( group ) => round( group.getObjectByName( 'ground:bedrock' ).geometry.getAttribute( 'position' ).getY( 0 ) );

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
