import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildRooms, reflectanceOf } from './InteriorRooms.js';

/** One triangle, given as three world-space corners. */
function triangle( points ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( points.flat(), 3 ) );

	return geometry;

}

const floors = [ {
	floor: 0,
	elevation: 0,
	height: 3,
	rooms: [ { id: 'r0', kind: 'living', polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] } ],
	lights: [ {
		id: 'l0', kind: 'spot', room: 'r0', position: [ 2, 2.6, 2 ],
		length: 0, angleDeg: 0, intensity: 900, colorTemperatureK: 2700,
		range: 4, beamDeg: 100, diffuse: 0.4, facing: 'down'
	} ]
} ];

/**
 * The whole per-room lighting design stands on this partition being right: a
 * surface has to end up in the room it is in, everything else has to end up
 * somewhere rather than being dropped, and the room has to come back measured,
 * because the fill light is computed from those measurements.
 */
describe( 'buildRooms', () => {

	const cut = () => buildRooms( 'p0', new Map( [
		// A 2 x 2 patch of floor inside the room, facing up.
		[ 'cyberpunk/carpet/mid', [ triangle( [ [ 1, 0, 1 ], [ 3, 0, 1 ], [ 1, 0, 3 ] ] ) ] ],
		// A patch of the same floor outside every room polygon.
		[ 'cyberpunk/concrete/mid', [ triangle( [ [ 9, 0, 9 ], [ 11, 0, 9 ], [ 9, 0, 11 ] ] ) ] ]
	] ), floors, ( key ) => reflectanceOf( key ) );

	it( 'puts a surface in the room it stands in and everything else in the shared set', () => {

		const { rooms, shared } = cut();

		expect( rooms ).toHaveLength( 1 );
		expect( rooms[ 0 ].id ).toBe( 'r0' );
		expect( [ ...rooms[ 0 ].meshes.map( ( m ) => m.key ) ] ).toEqual( [ 'cyberpunk/carpet/mid' ] );
		expect( [ ...shared.keys() ] ).toEqual( [ 'cyberpunk/concrete/mid' ] );

	} );

	it( 'measures the room the fill light is computed from', () => {

		const room = cut().rooms[ 0 ];

		expect( room.area ).toBeCloseTo( 2, 3 );
		// Up-facing surfaces are measured on their own: a floor bounces
		// different light than a ceiling.
		expect( room.floorAlbedo.r ).toBeGreaterThan( 0 );
		expect( room.albedo.r ).toBeGreaterThan( 0 );

	} );

	it( 'hands the room the fixtures published for it, in lumens', () => {

		const room = cut().rooms[ 0 ];

		expect( room.fixtures ).toHaveLength( 1 );
		expect( room.fixtures[ 0 ].lumens ).toBe( 900 );
		expect( room.flux ).toBe( 900 );
		// 2700 K: the room's own light is warm before anything shades with it.
		expect( room.color.r ).toBeGreaterThan( room.color.b );

	} );

} );
