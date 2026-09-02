import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { GroundBuilder, SIDEWALK_HEIGHT } from './GroundBuilder.js';

const factory = { build: () => new THREE.MeshStandardMaterial() };
const ground = ( ...covers ) => new GroundBuilder( { volumetric: { ground: covers } }, factory ).build();
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

		const { group } = ground( ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) );
		const strip = group.getObjectByName( 'ground:curb' );

		expect( strip ).toBeDefined();
		expect( span( strip.geometry ) ).toEqual( [ SIDEWALK_HEIGHT + 0.004, SIDEWALK_HEIGHT + 0.004 ] );

	} );

	it( 'stands the strip on a face down to the roadway, and nothing else', () => {

		const { group } = ground( ROAD, STRIP, rect( 'sidewalk', 10.15, 16 ) );
		const kerb = group.getObjectByName( 'ground:kerb' );

		// Two triangles: the one edge of the strip with road on the other side.
		expect( kerb.geometry.getAttribute( 'position' ).count ).toBe( 6 );
		expect( span( kerb.geometry ) ).toEqual( [ - 0.06, SIDEWALK_HEIGHT + 0.004 ] );

	} );

	it( 'still cuts a kerb from the pavement in a world published without a strip', () => {

		const { group } = ground( ROAD, rect( 'sidewalk', 10, 16 ) );
		const kerb = group.getObjectByName( 'ground:kerb' );

		expect( group.getObjectByName( 'ground:curb' ) ).toBeUndefined();
		// The same face, and the stone's top band along it.
		expect( kerb.geometry.getAttribute( 'position' ).count ).toBe( 12 );
		expect( span( kerb.geometry ) ).toEqual( [ - 0.06, SIDEWALK_HEIGHT + 0.004 ] );

	} );

} );

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
