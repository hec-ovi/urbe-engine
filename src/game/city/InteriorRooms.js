import { floorPlacements } from './InteriorLayouts.js';
import * as THREE from 'three/webgpu';
import { roomFootprintAnchor, roomFootprintContains } from '../../../../interior/src/core/room-footprint.ts';
import { RoomFill, albedoOf } from '../light/RoomFill.js';
import { kelvinColor } from '../light/Color.js';

/**
 * The rooms of one furnished floor, as the game holds them.
 *
 * A room is what the interior box published for it: a footprint, the fixtures
 * hanging in it, and the surfaces its modules stand as. Nothing here owns
 * geometry, because every module surface is drawn once for the whole city;
 * a room exists so its fixtures can be lit, its fill can be carried by the
 * copies standing in it, its air can be measured, and the player can be told
 * which room they are standing in.
 */

/** Modules that are not room surface: lit fixtures, what hangs on a wall, furniture, the lift. */
const UNMEASURED = /^(lift-|ceiling-spot|ceiling-cove-|ceiling-led-strip|wall-light-line|wall-screen|wall-art|wall-shelf|fit-)/;
/** The modules whose top face is the surface people walk on: slabs and the carpets over them. */
const WALKED = /^floor-/;

/**
 * @param floor one record from `buildingFloors`
 * @param catalog `{ boundsOf, slotsOf }` from the module catalog
 * @returns one Room per published room on this floor
 */
export function roomsOf( floor, catalog ) {

	const measured = measure( floor, catalog );
	const fixtures = fixturesByRoom( floor );

	return floor.rooms.map( ( room ) => new Room( {
		floor, room,
		fixtures: fixtures.get( room.id ) ?? [],
		surfaces: measured.get( room.id ) ?? []
	} ) );

}

/**
 * How much surface of what reflectance each room holds, from the modules
 * standing in it: a module's outer area at the size the placement scales it to,
 * at the mean reflectance of the slots it wears. That is what makes the fill
 * light computable rather than dialled.
 */
function measure( floor, catalog ) {

	const byRoom = new Map();

	for ( const placement of floorPlacements( floor ) ) {

		if ( ! placement.module || UNMEASURED.test( placement.module ) ) continue;

		const bounds = catalog.boundsOf( placement.module );
		const slots = catalog.slotsOf( placement.module );
		if ( ! bounds || ! slots.length ) continue;

		const [ w, h, d ] = bounds.size.map( ( value, axis ) => value * placement.scale[ axis ] );
		if ( ! byRoom.has( placement.room ) ) byRoom.set( placement.room, [] );

		byRoom.get( placement.room ).push( {
			albedo: slots.reduce( ( sum, slot ) => sum + albedoOf( slot ), 0 ) / slots.length,
			area: 2 * ( w * d + w * h + d * h ),
			floorArea: WALKED.test( placement.module ) ? w * d : 0
		} );

	}

	return byRoom;

}

/** One published room of one floor. */
export class Room {

	constructor( { floor, room, fixtures, surfaces } ) {

		const [ x, z ] = roomFootprintAnchor( room );

		this.id = `${floor.id}:${room.id}`;
		this.roomId = room.id;
		this.parcelId = floor.parcelId;
		this.floor = floor.floor;
		this.kind = room.kind;
		this.polygon = room.polygon;
		this.holes = room.holes ?? [];
		this.elevation = floor.elevation;
		this.height = floor.height;
		this.center = new THREE.Vector3( x, floor.elevation + floor.height / 2, z );
		this.visible = false;

		const whole = new Reflectance();
		const walked = new Reflectance();

		for ( const surface of surfaces ) {

			whole.add( surface.area, surface.albedo );
			walked.add( surface.floorArea, surface.albedo );

		}

		this.area = whole.area;
		this.albedo = whole.color();
		this.floorAlbedo = walked.area > 0 ? walked.color() : this.albedo.clone();
		this.fixtures = fixtures;
		this.flux = fixtures.reduce( ( sum, fixture ) => sum + fixture.lumens, 0 );
		this.color = new THREE.Color( 0, 0, 0 );

		for ( const fixture of fixtures ) {

			addScaled( this.color, fixture.color, fixture.lumens / Math.max( 1, this.flux ) );

		}

		/** What every copy standing in this room carries: its interreflected light. */
		this.fill = RoomFill.perCopy( this, this.flux, this.color );

	}

	/** Published occupied footprint at this storey's height. Core exclusions stay outside. */
	holds( feet ) {

		return feet.y >= this.elevation - 0.5 && feet.y <= this.elevation + this.height
			&& roomFootprintContains( this, [ feet.x, feet.z ] );

	}

}

/**
 * The fill for a copy standing in no published room, a stair shaft or a lift
 * lobby: the floor's rooms taken together, flux over surface, so it is lit
 * air rather than a hole.
 */
export function floorFill( rooms ) {

	const whole = { area: 0, albedo: new THREE.Color( 0, 0, 0 ), floorAlbedo: new THREE.Color( 0, 0, 0 ) };
	const color = new THREE.Color( 0, 0, 0 );
	let flux = 0;

	for ( const room of rooms ) {

		flux += room.flux;
		whole.area += room.area;
		addScaled( color, room.color, room.flux );
		whole.albedo.add( room.albedo );
		whole.floorAlbedo.add( room.floorAlbedo );

	}

	if ( ! rooms.length ) return new THREE.Vector4();

	if ( flux > 0 ) color.multiplyScalar( 1 / flux );
	whole.albedo.multiplyScalar( 1 / rooms.length );
	whole.floorAlbedo.multiplyScalar( 1 / rooms.length );

	return RoomFill.perCopy( whole, flux, color );

}

/** Area-weighted reflectance of a set of surfaces. */
class Reflectance {

	constructor() {

		this.area = 0;
		this.weighted = 0;

	}

	add( area, scalar ) {

		this.area += area;
		this.weighted += area * scalar;

	}

	color() {

		const level = this.area > 0 ? this.weighted / this.area : 0.4;

		return new THREE.Color().setRGB( level, level, level, THREE.LinearSRGBColorSpace );

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
 * the units three wants: lumens as published, kelvin resolved to a colour. A
 * published range is a useful radius; a fixture further from the surface it
 * faces than its range reaches it anyway, or its beam would end in mid air:
 * a downlight or the cove at a wall's foot reaches the floor, the cove at its
 * top reaches the ceiling. A furniture lens keeps the placement id that
 * carries it.
 */
export function fixturesByRoom( floor ) {

	const byRoom = new Map();

	for ( const light of floor.lights ?? [] ) {

		if ( ! byRoom.has( light.room ) ) byRoom.set( light.room, [] );

		const above = light.position[ 1 ] - floor.elevation;

		byRoom.get( light.room ).push( {
			kind: light.kind,
			...( light.furniture ? { furniture: light.furniture } : {} ),
			position: new THREE.Vector3( light.position[ 0 ], light.position[ 1 ], light.position[ 2 ] ),
			lumens: light.intensity,
			color: light.color ? new THREE.Color().setRGB( ...light.color, THREE.LinearSRGBColorSpace ) : kelvinColor( light.colorTemperatureK ),
			...( light.axis ? { axis: new THREE.Vector3().fromArray( light.axis ) } : {} ),
			...( light.direction ? { direction: new THREE.Vector3().fromArray( light.direction ) } : {} ),
			range: Math.max( 0.5, light.range, light.facing === 'up' ? floor.height - above : above ),
			beamDeg: light.beamDeg || 100,
			diffuse: light.diffuse ?? 0.5,
			length: light.length || 0.6,
			angleDeg: light.angleDeg ?? 0,
			facing: light.facing ?? 'down'
		} );

	}

	return byRoom;

}
