import * as THREE from 'three/webgpu';
import { pointInRing } from '../ground/Polygons.js';
import { albedoOf } from '../light/RoomFill.js';
import { kelvinColor, luminance } from '../light/Color.js';

/** How far a triangle may sit outside a floor's own slab and still belong to it. */
const FLOOR_MARGIN = 0.3;
/** Room lookup grid, in metres. Rooms are tens of metres across at most. */
const CELL = 4;
/** A triangle this close to level and facing up counts as floor. */
const UP_FACING = 0.7;
/** Band for geometry over the roof or under the lowest slab: always drawn. */
export const OUTSIDE_FLOORS = Infinity;
/** Position, normal and uv of three vertices. */
const FLOATS_PER_TRIANGLE = 24;

/**
 * Cuts a building's interior into the rooms the interior box published for it,
 * so each room can be lit by its own fixtures. Every triangle is placed by its
 * centroid: the floor whose slab it sits on, then the room polygon it falls in.
 * Whatever falls in no room (cores, stairs, shafts, the inside of the facade)
 * still belongs to a floor and is kept under that floor's index, so a tower
 * can put the floors around the player in the scene and leave the other sixty
 * out of it.
 *
 * The walk also measures each room's surfaces, which is what makes the fill
 * light computable rather than dialled: real area per material, and the area
 * of the up-facing surfaces on their own, because a floor bounces different
 * light than a ceiling.
 *
 * Plain arrays in, plain arrays out: no scene objects, so it runs in the
 * interior worker. Every surface it returns is a view into one block, so the
 * whole cut is one buffer to hand over rather than thousands to copy.
 *
 * @param surfaces [{ key, position, normal, uv }] world space, non-indexed
 * Float32Arrays, one per source mesh
 * @param outlines the floors as `outlinesOf` keeps them
 * @returns { data, rooms, shared }: rooms as [{ id, kind, floor, elevation,
 * height, polygon, center: [x, y, z], surfaces }], shared as [{ floor,
 * surfaces }], every surface { key, position, normal, uv } merged per key and
 * viewing `data`, a room's also carrying the { area, floorArea } it measured
 */
export function partition( surfaces, outlines ) {

	const index = new FloorIndex( outlines );
	const rooms = new Map();
	const shared = new Map();

	for ( const surface of surfaces ) sort( surface, index, rooms, shared );

	const block = new Block( [ ...rooms.values(), ...shared.values() ] );

	return {
		data: block.data,
		rooms: [ ...rooms ]
			.map( ( [ room, buckets ] ) => ( { ...room, surfaces: block.pack( buckets ) } ) )
			.filter( ( room ) => room.surfaces.some( ( surface ) => surface.area > 0 ) ),
		shared: [ ...shared ].map( ( [ floor, buckets ] ) => ( { floor, surfaces: block.pack( buckets ) } ) )
	};

}

/** What the partition needs of the floor documents: the outline of every room. */
export function outlinesOf( floors ) {

	return floors.map( ( { floor, elevation, height, rooms = [] } ) => ( {
		floor, elevation, height,
		rooms: rooms.map( ( { id, kind, polygon } ) => ( { id, kind, polygon } ) )
	} ) );

}

/** What a worker transfers when it posts a cut: the one buffer every surface views. */
export function buffersOf( cut ) {

	return [ cut.data.buffer ];

}

/** The floors sorted by elevation, each answering which room a point stands in. */
class FloorIndex {

	constructor( outlines ) {

		this.floors = outlines.map( ( floor ) => new FloorOutline( floor ) ).sort( ( a, b ) => a.low - b.low );

	}

	/** The floor whose slab band holds `y`, or null over the roof or under the lowest slab. */
	at( y ) {

		for ( const floor of this.floors ) {

			if ( y >= floor.low && y < floor.high ) return floor;

		}

		return null;

	}

}

/** One floor's rooms under a grid, so a point tests one or two polygons, not ten. */
class FloorOutline {

	constructor( { floor, elevation, height, rooms } ) {

		this.index = floor;
		this.low = elevation - FLOOR_MARGIN;
		this.high = elevation + height + FLOOR_MARGIN;
		this.rooms = rooms.map( ( { id, kind, polygon } ) => ( {
			id, kind, floor, elevation, height, polygon,
			center: centreOf( polygon, elevation + height / 2 )
		} ) );
		this.grid = new Map();

		this.rooms.forEach( ( room, i ) => {

			let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

			for ( const [ x, z ] of room.polygon ) {

				minX = Math.min( minX, x ); maxX = Math.max( maxX, x );
				minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z );

			}

			for ( let cx = Math.floor( minX / CELL ); cx <= Math.floor( maxX / CELL ); cx ++ ) {

				for ( let cz = Math.floor( minZ / CELL ); cz <= Math.floor( maxZ / CELL ); cz ++ ) {

					const cell = cellOf( cx, cz );

					if ( ! this.grid.has( cell ) ) this.grid.set( cell, [] );

					this.grid.get( cell ).push( i );

				}

			}

		} );

	}

	/** The room whose polygon holds the point, or null on a core, a stair, the facade. */
	roomAt( x, z ) {

		for ( const i of this.grid.get( cellOf( Math.floor( x / CELL ), Math.floor( z / CELL ) ) ) ?? [] ) {

			const room = this.rooms[ i ];

			if ( pointInRing( x, z, room.polygon ) ) return room;

		}

		return null;

	}

}

/** One number per grid cell; cells stay distinct within 200 km of the origin. */
function cellOf( cx, cz ) {

	return cx * 100000 + cz;

}

/**
 * The triangles of one key that landed in one room or on one shared floor,
 * gathered by index while the walk runs and copied out once at the end.
 */
class Bucket {

	constructor( key ) {

		this.key = key;
		this.parts = [];
		this.count = 0;
		this.area = 0;
		this.floorArea = 0;

	}

	/** @param vertex the index of the triangle's first vertex in `surface` */
	take( surface, vertex ) {

		let part = this.parts[ this.parts.length - 1 ];

		if ( part?.surface !== surface ) this.parts.push( part = { surface, starts: [] } );

		part.starts.push( vertex );
		this.count ++;

	}

	measure( area, upFacing ) {

		this.area += area;
		if ( upFacing ) this.floorArea += area;

	}

	/** One merged, non-indexed surface of this key, written into `data` from `at`. */
	pack( data, at ) {

		const position = data.subarray( at, at += this.count * 9 );
		const normal = data.subarray( at, at += this.count * 9 );
		const uv = data.subarray( at, at + this.count * 6 );
		let triangle = 0;

		for ( const { surface, starts } of this.parts ) {

			for ( const start of starts ) {

				copy( surface.position, start * 3, position, triangle * 9, 9 );
				copy( surface.normal, start * 3, normal, triangle * 9, 9 );
				copy( surface.uv, start * 2, uv, triangle * 6, 6 );
				triangle ++;

			}

		}

		return { key: this.key, area: this.area, floorArea: this.floorArea, position, normal, uv };

	}

}

function copy( from, at, to, into, floats ) {

	for ( let k = 0; k < floats; k ++ ) to[ into + k ] = from[ at + k ];

}

/** One array sized for every bucket of a cut, handed out slice by slice. */
class Block {

	constructor( bucketMaps ) {

		let floats = 0;

		for ( const buckets of bucketMaps ) {

			for ( const bucket of buckets.values() ) floats += bucket.count * FLOATS_PER_TRIANGLE;

		}

		this.data = new Float32Array( floats );
		this.at = 0;

	}

	pack( buckets ) {

		return [ ...buckets.values() ].map( ( bucket ) => {

			const surface = bucket.pack( this.data, this.at );
			this.at += bucket.count * FLOATS_PER_TRIANGLE;

			return surface;

		} );

	}

}

function bucketOf( owners, owner, key ) {

	let buckets = owners.get( owner );

	if ( ! buckets ) owners.set( owner, buckets = new Map() );

	let bucket = buckets.get( key );

	if ( ! bucket ) buckets.set( key, bucket = new Bucket( key ) );

	return bucket;

}

/** Walks one surface's triangles into room and shared buckets, measuring as it goes. */
function sort( surface, index, rooms, shared ) {

	const { key, position } = surface;

	for ( let vertex = 0; vertex * 3 < position.length; vertex += 3 ) {

		const o = vertex * 3;
		const ax = position[ o ], ay = position[ o + 1 ], az = position[ o + 2 ];
		const bx = position[ o + 3 ], by = position[ o + 4 ], bz = position[ o + 5 ];
		const cx = position[ o + 6 ], cy = position[ o + 7 ], cz = position[ o + 8 ];

		const floor = index.at( ( ay + by + cy ) / 3 );
		const room = floor?.roomAt( ( ax + bx + cx ) / 3, ( az + bz + cz ) / 3 );

		if ( ! room ) {

			// Still on a floor, even with no room around it: a stair flight, a
			// core wall, the inside of the facade. It belongs to that band.
			bucketOf( shared, floor?.index ?? OUTSIDE_FLOORS, key ).take( surface, vertex );
			continue;

		}

		const bucket = bucketOf( rooms, room, key );
		bucket.take( surface, vertex );

		const ux = bx - ax, uy = by - ay, uz = bz - az;
		const vx = cx - ax, vy = cy - ay, vz = cz - az;
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const length = Math.hypot( nx, ny, nz );

		bucket.measure( length / 2, length > 0 && ny / length > UP_FACING );

	}

}

function centreOf( polygon, y ) {

	const sum = polygon.reduce( ( acc, [ x, z ] ) => [ acc[ 0 ] + x, acc[ 1 ] + z ], [ 0, 0 ] );

	return [ sum[ 0 ] / polygon.length, y, sum[ 1 ] / polygon.length ];

}

/**
 * The key a mesh's material names, with the variant the interior box asked for
 * (`extras.materialVariant`, ../interior/CONTRACT.md) appended: a patterned
 * ceiling and a plain one are the same entry and must not share a bucket.
 */
export function materialKey( material ) {

	const key = material?.name ?? '';
	const variant = material?.userData?.materialVariant;

	return variant ? `${key}#${variant}` : key;

}

/** The database key of a bucket key, without the variant. */
export function plain( key ) {

	return key.split( '#' )[ 0 ];

}

/** One posted surface as the geometry a mesh draws, wrapping its arrays as they are. */
export function geometryOf( { position, normal, uv } ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( position, 3 ) );
	geometry.setAttribute( 'normal', new THREE.BufferAttribute( normal, 3 ) );
	geometry.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );

	return geometry;

}

/**
 * The rooms of one cut interior as the game holds them, one at a time: each
 * measured record becomes a Room with its geometry, its published fixtures and
 * the reflectance its fill light is computed from. A tower has hundreds, so
 * the caller decides how many it takes in one frame.
 *
 * @param cut what `partition` returned
 * @param floors the parcel's floor documents (../interior/CONTRACT.md)
 * @param reflectance (key) => { scalar, tint }
 */
export function* assembleRooms( parcelId, cut, floors, reflectance ) {

	const fixtures = new Map();

	for ( const floor of floors ) {

		for ( const [ id, list ] of fixturesByRoom( floor ) ) fixtures.set( id, list );

	}

	for ( const measured of cut.rooms ) {

		yield new Room( { parcelId, measured, fixtures: fixtures.get( measured.id ) ?? [], reflectance } );

	}

}

/**
 * One published room, as the game holds it: its own geometry, the fixtures the
 * interior box put in it, and the numbers its fill light is computed from. It
 * wears whichever light binding it currently holds; nothing else about it moves.
 */
export class Room {

	constructor( { parcelId, measured, fixtures, reflectance } ) {

		this.id = measured.id;
		this.parcelId = parcelId;
		this.floor = measured.floor;
		this.kind = measured.kind;
		this.center = new THREE.Vector3().fromArray( measured.center );
		this.polygon = measured.polygon;
		this.elevation = measured.elevation;
		this.height = measured.height;

		const whole = new Reflectance();
		const floor = new Reflectance();

		for ( const surface of measured.surfaces ) {

			const own = reflectance( surface.key );

			whole.add( surface.area, own );
			floor.add( surface.floorArea, own );

		}

		this.area = whole.area;
		this.albedo = whole.color();
		this.floorAlbedo = floor.area > 0 ? floor.color() : this.albedo.clone();
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

		for ( const surface of measured.surfaces ) {

			const mesh = new THREE.Mesh( geometryOf( surface ), null );
			mesh.name = `${this.group.name}:${surface.key}`;
			this.meshes.push( { mesh, key: surface.key } );
			this.group.add( mesh );

		}

	}

	/** Takes a light binding: every mesh swaps to that binding's material. */
	wear( binding, roomLights ) {

		this.binding = binding;

		for ( const { mesh, key } of this.meshes ) mesh.material = roomLights.materialFor( binding, key );

	}

}

/** Area-weighted reflectance of a set of surfaces: a level, and a measured hue. */
class Reflectance {

	constructor() {

		this.area = 0;
		this.weighted = 0;
		this.tint = new THREE.Color( 0, 0, 0 );

	}

	add( area, { scalar, tint } ) {

		this.area += area;
		this.weighted += area * scalar;
		addScaled( this.tint, tint, area );

	}

	/** Reflectance level times measured hue, normalised so the level is unchanged. */
	color() {

		const level = this.area > 0 ? this.weighted / this.area : 0.4;
		const hue = this.area > 0 ? _hue.copy( this.tint ).multiplyScalar( 1 / this.area ) : _hue.setRGB( 1, 1, 1 );
		const luma = Math.max( 1e-4, luminance( hue ) );

		return new THREE.Color().setRGB(
			level * hue.r / luma,
			level * hue.g / luma,
			level * hue.b / luma,
			THREE.LinearSRGBColorSpace
		);

	}

}

/** Colour accumulation: three.js colours add, but never with a weight. */
function addScaled( target, color, weight ) {

	target.r += color.r * weight;
	target.g += color.g * weight;
	target.b += color.b * weight;

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

const _hue = new THREE.Color();
const _white = new THREE.Color( 1, 1, 1 );
