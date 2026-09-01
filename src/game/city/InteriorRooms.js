import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInRing } from '../ground/Polygons.js';
import { albedoOf } from '../light/RoomFill.js';
import { kelvinColor } from '../light/Kelvin.js';

/** How far a triangle may sit outside a floor's own slab and still belong to it. */
const FLOOR_MARGIN = 0.3;
/** Room lookup grid, in metres. Rooms are tens of metres across at most. */
const CELL = 4;
/** A triangle this close to level and facing up counts as floor. */
const UP_FACING = 0.7;

/**
 * Cuts a building's interior into the rooms the interior box published for it,
 * so each room can be lit by its own fixtures. Every triangle is placed by its
 * centroid: the floor whose slab it sits on, then the room polygon it falls in.
 * Whatever falls in no room (cores, stairs, shafts, the inside of the facade)
 * stays one shared set per material key.
 *
 * The walk also measures each room, which is what makes the fill light
 * computable rather than dialled: real surface area, area-weighted
 * reflectance, and the reflectance of the up-facing surfaces on their own,
 * because a floor bounces different light than a ceiling.
 *
 * @param byKey Map<materialKey, geometry[]> in world space
 * @param floors the parcel's floor documents (../interior/CONTRACT.md)
 * @param reflectance (key) => { scalar, tint }
 * @returns { rooms: Room[], shared: Map<key, geometry[]> }
 */
export function buildRooms( parcelId, byKey, floors, reflectance ) {

	const index = floorIndex( floors );
	const buckets = new Map();
	const shared = new Map();

	for ( const [ key, geometries ] of byKey ) {

		const surface = reflectance( key );

		for ( const geometry of geometries ) {

			sort( geometry, key, surface, index, buckets, shared );
			geometry.dispose();

		}

	}

	const fixtures = new Map();

	for ( const floor of floors ) {

		for ( const [ id, list ] of fixturesByRoom( floor ) ) fixtures.set( id, list );

	}

	const rooms = [];

	for ( const { room, byKey: roomKeys } of buckets.values() ) {

		if ( room.area <= 0 ) continue;

		rooms.push( new Room( {
			parcelId,
			measured: room,
			fixtures: fixtures.get( room.id ) ?? [],
			byKey: roomKeys
		} ) );

	}

	return { rooms, shared };

}

/** Floors sorted by elevation, each carrying a grid over its own rooms. */
function floorIndex( floors ) {

	return floors
		.map( ( floor ) => {

			const rooms = ( floor.rooms ?? [] ).map( ( room ) => ( {
				id: room.id,
				kind: room.kind,
				polygon: room.polygon,
				floor: floor.floor,
				elevation: floor.elevation,
				height: floor.height,
				center: centreOf( room.polygon, floor.elevation + floor.height / 2 ),
				area: 0,
				weighted: 0,
				tint: new THREE.Color( 0, 0, 0 ),
				floorArea: 0,
				floorWeighted: 0,
				floorTint: new THREE.Color( 0, 0, 0 )
			} ) );

			return {
				low: floor.elevation - FLOOR_MARGIN,
				high: floor.elevation + floor.height + FLOOR_MARGIN,
				rooms,
				grid: roomGrid( rooms )
			};

		} )
		.sort( ( a, b ) => a.low - b.low );

}

/** Cell to candidate rooms, so a triangle tests one or two polygons, not ten. */
function roomGrid( rooms ) {

	const grid = new Map();

	rooms.forEach( ( room, i ) => {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

		for ( const [ x, z ] of room.polygon ) {

			minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
			minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z );

		}

		for ( let cx = Math.floor( minX / CELL ); cx <= Math.floor( maxX / CELL ); cx ++ ) {

			for ( let cz = Math.floor( minZ / CELL ); cz <= Math.floor( maxZ / CELL ); cz ++ ) {

				const cell = `${cx}:${cz}`;
				if ( ! grid.has( cell ) ) grid.set( cell, [] );
				grid.get( cell ).push( i );

			}

		}

	} );

	return grid;

}

/** Walks one geometry's triangles into per-room buckets, measuring as it goes. */
function sort( geometry, key, surface, index, buckets, shared ) {

	const position = geometry.getAttribute( 'position' );
	const a = _a, b = _b, c = _c;
	const lists = new Map();
	const loose = [];

	for ( let i = 0; i < position.count; i += 3 ) {

		a.fromBufferAttribute( position, i );
		b.fromBufferAttribute( position, i + 1 );
		c.fromBufferAttribute( position, i + 2 );
		_centroid.copy( a ).add( b ).add( c ).multiplyScalar( 1 / 3 );

		const room = locate( index, _centroid );

		if ( ! room ) {

			loose.push( i );
			continue;

		}

		if ( ! lists.has( room.id ) ) lists.set( room.id, { room, indices: [] } );

		lists.get( room.id ).indices.push( i );

		_cross.crossVectors( _ab.subVectors( b, a ), _ac.subVectors( c, a ) );
		const area = _cross.length() / 2;

		room.area += area;
		room.weighted += area * surface.scalar;
		addScaled( room.tint, surface.tint, area );

		if ( area > 0 && _cross.normalize().y > UP_FACING ) {

			room.floorArea += area;
			room.floorWeighted += area * surface.scalar;
			addScaled( room.floorTint, surface.tint, area );

		}

	}

	for ( const { room, indices } of lists.values() ) {

		if ( ! buckets.has( room.id ) ) buckets.set( room.id, { room, byKey: new Map() } );

		push( buckets.get( room.id ).byKey, key, take( geometry, indices ) );

	}

	if ( loose.length ) push( shared, key, take( geometry, loose ) );

}

/** The room a point stands in, or null when it belongs to the building itself. */
function locate( index, point ) {

	for ( const floor of index ) {

		if ( point.y < floor.low || point.y >= floor.high ) continue;

		const cell = `${Math.floor( point.x / CELL )}:${Math.floor( point.z / CELL )}`;

		for ( const i of floor.grid.get( cell ) ?? [] ) {

			const room = floor.rooms[ i ];

			if ( pointInRing( point.x, point.z, room.polygon ) ) return room;

		}

		return null;

	}

	return null;

}

/** A new geometry from the listed triangle starts of `geometry`. */
function take( geometry, starts ) {

	const out = new THREE.BufferGeometry();

	for ( const name of [ 'position', 'normal', 'uv' ] ) {

		const source = geometry.getAttribute( name );

		if ( ! source ) continue;

		const size = source.itemSize;
		const data = new Float32Array( starts.length * 3 * size );
		let write = 0;

		for ( const start of starts ) {

			for ( let v = 0; v < 3; v ++ ) {

				for ( let k = 0; k < size; k ++ ) data[ write ++ ] = source.array[ ( start + v ) * size + k ];

			}

		}

		out.setAttribute( name, new THREE.BufferAttribute( data, size ) );

	}

	return out;

}

function push( map, key, geometry ) {

	if ( ! map.has( key ) ) map.set( key, [] );

	map.get( key ).push( geometry );

}

/** Colour accumulation: three.js colours add, but never with a weight. */
function addScaled( target, color, weight ) {

	target.r += color.r * weight;
	target.g += color.g * weight;
	target.b += color.b * weight;

}

function centreOf( polygon, y ) {

	const sum = polygon.reduce( ( acc, [ x, z ] ) => [ acc[ 0 ] + x, acc[ 1 ] + z ], [ 0, 0 ] );

	return new THREE.Vector3( sum[ 0 ] / polygon.length, y, sum[ 1 ] / polygon.length );

}

/** Reflectance level times measured hue, normalised so the level is unchanged. */
function reflectanceColor( weighted, area, tint, target ) {

	const level = area > 0 ? weighted / area : 0.4;
	const hue = area > 0 ? _hue.copy( tint ).multiplyScalar( 1 / area ) : _hue.setRGB( 1, 1, 1 );
	const luma = Math.max( 1e-4, hue.r * 0.2126 + hue.g * 0.7152 + hue.b * 0.0722 );

	return target.setRGB(
		level * hue.r / luma,
		level * hue.g / luma,
		level * hue.b / luma,
		THREE.LinearSRGBColorSpace
	);

}

/**
 * One published room, as the game holds it: its own geometry, the fixtures the
 * interior box put in it, and the numbers its fill light is computed from. It
 * wears whichever light binding it currently holds; nothing else about it moves.
 */
export class Room {

	constructor( { parcelId, measured, fixtures, byKey } ) {

		this.id = measured.id;
		this.parcelId = parcelId;
		this.floor = measured.floor;
		this.kind = measured.kind;
		this.center = measured.center;
		this.polygon = measured.polygon;
		this.elevation = measured.elevation;
		this.height = measured.height;
		this.area = measured.area;
		this.albedo = reflectanceColor( measured.weighted, measured.area, measured.tint, new THREE.Color() );
		this.floorAlbedo = measured.floorArea > 0
			? reflectanceColor( measured.floorWeighted, measured.floorArea, measured.floorTint, new THREE.Color() )
			: this.albedo.clone();
		this.fixtures = fixtures;
		this.binding = null;
		this.meshes = [];

		this.flux = fixtures.reduce( ( sum, f ) => sum + f.lumens, 0 );
		this.color = new THREE.Color( 0, 0, 0 );

		for ( const fixture of fixtures ) {

			addScaled( this.color, fixture.color, fixture.lumens / Math.max( 1, this.flux ) );

		}

		this.group = new THREE.Group();
		this.group.name = `room:${parcelId}:${this.id}`;
		this.triangles = 0;

		for ( const [ key, geometries ] of byKey ) {

			const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
			geometries.forEach( ( g ) => g.dispose() );
			this.triangles += merged.getAttribute( 'position' ).count / 3;
			const mesh = new THREE.Mesh( merged, null );
			mesh.name = `${this.group.name}:${key}`;
			this.meshes.push( { mesh, key } );
			this.group.add( mesh );

		}

	}

	/** Takes a light binding: every mesh swaps to that binding's material. */
	wear( binding, roomLights ) {

		this.binding = binding;

		for ( const { mesh, key } of this.meshes ) mesh.material = roomLights.materialFor( binding, key );

	}

}

/**
 * The fixtures of one floor, grouped by the room they were published for, in
 * the units three wants: lumens as published, kelvin resolved to a colour.
 */
export function fixturesByRoom( floor ) {

	const byRoom = new Map();

	for ( const light of floor.lights ?? [] ) {

		if ( ! byRoom.has( light.room ) ) byRoom.set( light.room, [] );

		byRoom.get( light.room ).push( {
			kind: light.kind,
			position: new THREE.Vector3( light.position[ 0 ], light.position[ 1 ], light.position[ 2 ] ),
			lumens: light.intensity,
			color: kelvinColor( light.colorTemperatureK ),
			range: Math.max( 0.5, light.range ),
			beamDeg: light.beamDeg || 100,
			diffuse: light.diffuse ?? 0.5,
			length: light.length || 0.6,
			angleDeg: light.angleDeg ?? 0,
			facing: light.facing ?? 'down'
		} );

	}

	return byRoom;

}

/** Reflectance of a material key: level from its kind, hue from its own map. */
export function reflectanceOf( key, tint ) {

	return { scalar: albedoOf( key ), tint: tint ?? _white };

}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _cross = new THREE.Vector3();
const _centroid = new THREE.Vector3();
const _hue = new THREE.Color();
const _white = new THREE.Color( 1, 1, 1 );
