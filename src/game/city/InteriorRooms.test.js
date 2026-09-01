import { describe, expect, it } from 'vitest';
import {
	assembleRooms, buffersOf, geometryOf, materialKey, outlinesOf, partition, plain, reflectanceOf, OUTSIDE_FLOORS
} from './InteriorRooms.js';

/** One source mesh of one key, given as triangles of three world-space corners each. */
function surface( key, triangles ) {

	return {
		key,
		position: new Float32Array( triangles.flat( 2 ) ),
		normal: new Float32Array( triangles.length * 9 ),
		uv: new Float32Array( triangles.length * 6 )
	};

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

const surfaces = [
	// A 2 x 2 patch of floor inside the room, facing up.
	surface( 'cyberpunk/carpet/mid', [ [ [ 1, 0, 1 ], [ 3, 0, 1 ], [ 1, 0, 3 ] ] ] ),
	// A second mesh of the same carpet in the same room: one bucket, not two.
	surface( 'cyberpunk/carpet/mid', [ [ [ 3, 0, 3 ], [ 3, 0, 1 ], [ 1, 0, 3 ] ] ] ),
	// A patch of the same floor outside every room polygon.
	surface( 'cyberpunk/concrete/mid', [ [ [ 9, 0, 9 ], [ 11, 0, 9 ], [ 9, 0, 11 ] ] ] ),
	// Parapet over the roof: on no floor at all.
	surface( 'cyberpunk/concrete/mid', [ [ [ 1, 30, 1 ], [ 3, 30, 1 ], [ 1, 30, 3 ] ] ] )
];

const triangles = ( { position } ) => position.length / 9;
const reflectance = ( key ) => reflectanceOf( key );
const rooms = ( cut ) => [ ...assembleRooms( 'p0', cut, floors, reflectance ) ];

/**
 * The whole per-room lighting design stands on this partition being right: a
 * surface has to end up in the room it is in, everything else has to end up
 * somewhere rather than being dropped, and the room has to come back measured,
 * because the fill light is computed from those measurements.
 */
describe( 'partition', () => {

	const cut = () => partition( surfaces, outlinesOf( floors ) );

	it( 'puts a surface in the room it stands in and everything else on its floor', () => {

		const { rooms, shared } = cut();

		expect( rooms ).toHaveLength( 1 );
		expect( rooms[ 0 ].id ).toBe( 'r0' );
		expect( rooms[ 0 ].floor ).toBe( 0 );
		expect( rooms[ 0 ].surfaces.map( ( s ) => s.key ) ).toEqual( [ 'cyberpunk/carpet/mid' ] );
		// A core wall or a stair belongs to no room but still stands on a floor,
		// which is what lets a tower put one floor band in the scene at a time;
		// what stands on no floor is always drawn.
		expect( shared.map( ( band ) => band.floor ) ).toEqual( [ 0, OUTSIDE_FLOORS ] );
		expect( shared[ 0 ].surfaces.map( ( s ) => s.key ) ).toEqual( [ 'cyberpunk/concrete/mid' ] );

	} );

	it( 'keeps every triangle once, through the worker hand-over and into the room meshes', () => {

		const posted = structuredClone( cut() );

		// Two carpet meshes became one surface of two triangles; nothing was lost.
		expect( posted.rooms[ 0 ].surfaces.map( triangles ) ).toEqual( [ 2 ] );
		expect( posted.shared.map( ( band ) => band.surfaces.map( triangles ) ) ).toEqual( [ [ 1 ], [ 1 ] ] );
		// One buffer carries the whole cut, so it is one transfer, not thousands.
		expect( buffersOf( posted ) ).toEqual( [ posted.data.buffer ] );
		expect( posted.rooms[ 0 ].surfaces[ 0 ].position.buffer ).toBe( posted.data.buffer );

		const [ room ] = rooms( posted );
		const count = ( mesh ) => mesh.geometry.getAttribute( 'position' ).count / 3;

		expect( room.meshes.map( ( { mesh } ) => count( mesh ) ) ).toEqual( [ 2 ] );
		expect( count( { geometry: geometryOf( posted.shared[ 0 ].surfaces[ 0 ] ) } ) ).toBe( 1 );

	} );

	it( 'cuts one floor\'s own file to exactly that floor\'s share of the whole building', () => {

		const upstairs = [
			{ ...floors[ 0 ], floor: 1, elevation: 3, rooms: [ { id: 'r1', kind: 'living', polygon: floors[ 0 ].rooms[ 0 ].polygon } ], lights: [] }
		];
		const both = outlinesOf( [ ...floors, ...upstairs ] );
		const floorFile = [
			surface( 'cyberpunk/carpet/mid', [ [ [ 1, 3, 1 ], [ 3, 3, 1 ], [ 1, 3, 3 ] ] ] ),
			surface( 'cyberpunk/concrete/mid', [ [ [ 9, 3, 9 ], [ 11, 3, 9 ], [ 9, 3, 11 ] ] ] )
		];
		const share = ( cut ) => ( {
			rooms: cut.rooms.filter( ( room ) => room.floor === 1 ).map( ( room ) => [ room.id, room.area, room.surfaces.map( ( s ) => [ s.key, [ ...s.position ] ] ) ] ),
			shared: cut.shared.filter( ( band ) => band.floor === 1 ).map( ( band ) => band.surfaces.map( ( s ) => [ s.key, [ ...s.position ] ] ) )
		} );

		const alone = share( partition( floorFile, both ) );

		expect( alone.rooms ).toHaveLength( 1 );
		expect( alone.shared ).toHaveLength( 1 );
		expect( alone ).toEqual( share( partition( [ ...surfaces, ...floorFile ], both ) ) );

	} );

	it( 'measures the room the fill light is computed from', () => {

		const [ room ] = rooms( cut() );

		expect( room.area ).toBeCloseTo( 4, 3 );
		// Up-facing surfaces are measured on their own: a floor bounces
		// different light than a ceiling.
		expect( room.floorAlbedo.r ).toBeGreaterThan( 0 );
		expect( room.albedo.r ).toBeGreaterThan( 0 );

	} );

	it( 'hands the room the fixtures published for it, in lumens', () => {

		const [ room ] = rooms( cut() );

		expect( room.fixtures ).toHaveLength( 1 );
		expect( room.fixtures[ 0 ].lumens ).toBe( 900 );
		expect( room.flux ).toBe( 900 );
		// 2700 K: the room's own light is warm before anything shades with it.
		expect( room.color.r ).toBeGreaterThan( room.color.b );

	} );

} );

/**
 * Two meshes of the same database entry and different variants are two looks
 * (a patterned ceiling and a plain one), so they must not share a bucket or the
 * second one silently wears the first one's material.
 */
describe( 'materialKey', () => {

	it( 'carries the variant the interior box asked for', () => {

		const key = materialKey( {
			name: 'cyberpunk/ceiling/high_rich',
			userData: { materialVariant: 'panel' }
		} );

		expect( key ).toBe( 'cyberpunk/ceiling/high_rich#panel' );
		expect( plain( key ) ).toBe( 'cyberpunk/ceiling/high_rich' );

	} );

	it( 'is the plain key when no variant is named', () => {

		expect( materialKey( { name: 'cyberpunk/concrete/high_rich', userData: {} } ) ).toBe( 'cyberpunk/concrete/high_rich' );

	} );

} );
