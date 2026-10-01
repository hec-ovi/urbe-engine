import { floorPlacements } from './InteriorLayouts.js';
import * as THREE from 'three/webgpu';
import { roomFootprintAnchor, roomFootprintContains } from '../../../../interior/src/core/room-footprint.ts';
import { RoomFill, albedoOf } from '../light/RoomFill.js';
import { daylightSpread, planSamples, roomDaylight } from '../light/RoomDaylight.js';
import { kelvinColor, luminance } from '../light/Color.js';

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
 * @param unseen fixtures -> the light of them no room light draws (RoomLights.unseen), which the fill carries
 * @param daylight { windows, sky }: the storey's glass (light/RoomDaylight.js glazingOf) and the day it is built in
 * @returns one Room per published room on this floor
 */
export function roomsOf( floor, catalog, unseen = null, daylight = null ) {

	const measured = measure( floor, catalog );
	const fixtures = fixturesByRoom( floor );

	return floor.rooms.map( ( room ) => new Room( {
		floor, room,
		fixtures: fixtures.get( room.id ) ?? [],
		surfaces: measured.get( room.id ) ?? [],
		unseen,
		daylight
	} ) );

}

/**
 * What reflectance each room's surfaces carry, from the modules standing in
 * it: a module's outer area at the size the placement scales it to, at the
 * mean reflectance of the slots it wears. These areas weight the reflectance
 * and nothing else; how much surface the room actually encloses is measured
 * from its own outline, because a module's bounding box counts backs buried in
 * walls and every face a neighbour hides, which on the played floors comes to
 * about twice the room's real enclosing surface and up to six times in a
 * corridor.
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

	constructor( { floor, room, fixtures, surfaces, unseen = null, daylight = null } ) {

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
		/** The room's own extent on the ground, which is what being in view is tested against. */
		this.bounds = extentOf( this.polygon, x, z );
		this.visible = false;

		const whole = new Reflectance();
		const walked = new Reflectance();

		for ( const surface of surfaces ) {

			whole.add( surface.area, surface.albedo );
			walked.add( surface.floorArea, surface.albedo );

		}

		// The surface the room's own light bounces around in: its floor, its
		// ceiling and its walls, from the outline the interior published, with
		// the vertical core and any other hole counted on both counts.
		this.area = enclosure( this.polygon, this.holes, this.height ) || whole.area;
		this.albedo = whole.color();
		this.floorAlbedo = walked.area > 0 ? walked.color() : this.albedo.clone();
		this.fixtures = fixtures;
		this.flux = fixtures.reduce( ( sum, fixture ) => sum + fixture.lumens, 0 );
		this.color = new THREE.Color( 0, 0, 0 );

		for ( const fixture of fixtures ) {

			addScaled( this.color, fixture.color, fixture.lumens / Math.max( 1, this.flux ) );

		}

		/** The light of the fixtures no room light draws, which the fill carries instead. */
		this.unseen = unseen?.( fixtures ) ?? null;
		this.lit = RoomFill.parts( this, this.flux, this.color, this.unseen ?? undefined );
		/**
		 * The day through the room's own glass (light/RoomDaylight.js), or null:
		 * lumens landing on the floor and on the ceiling, their colours, where it
		 * comes in, and how much of the room's mean lands at a point.
		 */
		this.daylit = this.#daylight( daylight );
		/** What every copy standing in this room carries on average: its interreflected light, the undrawn fixtures' and the day's. */
		this.fill = this.fillAt();
		/**
		 * The grade a room its glass lights asks the eye for, by day, in stops
		 * under the night's: past a bright room's light the eye closes down,
		 * so a daylit room reads as a bright one, not as the glare it is.
		 */
		this.dayStops = this.daylit ? daylightStops( this.fill ) : 0;

	}

	/**
	 * The fill a copy carries at a point of the room's plan: the same
	 * everywhere but for the day, which lands near the glass it came through.
	 * With no point, the room's mean.
	 */
	fillAt( x, z, target = new THREE.Vector4() ) {

		const day = this.daylit;
		if ( ! day ) return RoomFill.pack( this.lit.up, this.lit.down, target );

		const weight = x === undefined ? 1 : day.spread( x, z );
		const landing = RoomFill.landing( this );

		_up.copy( this.lit.up ).add( day.bounce.up ).add( _part.copy( day.downColor ).multiplyScalar( day.down / landing * weight ) );
		_down.copy( this.lit.down ).add( day.bounce.down ).add( _part.copy( day.upColor ).multiplyScalar( day.up / landing * weight ) );

		return RoomFill.pack( _up, _down, target );

	}

	#daylight( daylight ) {

		if ( ! daylight?.windows?.length ) return null;

		const contains = ( x, z ) => roomFootprintContains( this, [ x, z ] );
		const day = roomDaylight( contains, daylight.windows, daylight.sky );
		if ( ! day ) return null;

		const total = day.down + day.up;
		const color = new THREE.Color( 0, 0, 0 );
		addScaled( color, day.downColor, day.down / total );
		addScaled( color, day.upColor, day.up / total );
		// The day bounces round the room as the lamps' light does; where it
		// first lands is the spread's.
		day.bounce = RoomFill.parts( this, total, color );
		day.flux = total;
		day.spread = daylightSpread( day.sources, planSamples( this.bounds, this.area / 2, contains ) );

		return day;

	}

	/** Published occupied footprint at this storey's height. Core exclusions stay outside. */
	holds( feet ) {

		return feet.y >= this.elevation - 0.5 && feet.y <= this.elevation + this.height
			&& roomFootprintContains( this, [ feet.x, feet.z ] );

	}

}

/**
 * The mean illuminance a room reads at under the night's grade before the eye
 * closes down for it, in lux: a bright room, about twice a lit shop floor's.
 */
const BRIGHT_ROOM = 400;
/** The most a room's daylight closes the eye down, in stops. */
const DAY_STOPS = 6;

/**
 * The stops under the night's grade a room asks for, from its mean fill:
 * none until its surfaces average a bright room's light, then the ratio.
 */
export function daylightStops( fill ) {

	const lux = luminance( _mean.setRGB( fill.x, fill.y, fill.z ) ) * ( 1 + fill.w ) / 2;

	return - Math.min( DAY_STOPS, Math.max( 0, Math.log2( lux / BRIGHT_ROOM ) ) );

}

const _mean = new THREE.Color();

/**
 * The fill for a copy standing in no published room, a stair shaft or a lift
 * lobby: the floor's rooms taken together, flux over surface, so it is lit
 * air rather than a hole. A fixture published for a room the floor never built
 * is drawn by no light, so its light is the fill's whole.
 */
export function floorFill( rooms, orphans = [] ) {

	const whole = { area: 0, albedo: new THREE.Color( 0, 0, 0 ), floorAlbedo: new THREE.Color( 0, 0, 0 ) };
	const color = new THREE.Color( 0, 0, 0 );
	const unseen = { down: 0, up: 0, downColor: new THREE.Color( 0, 0, 0 ), upColor: new THREE.Color( 0, 0, 0 ) };
	const undrawn = ( side, lumens, tint ) => {

		unseen[ side ] += lumens;
		addScaled( unseen[ `${side}Color` ], tint, lumens );

	};
	let flux = 0;

	for ( const room of rooms ) {

		flux += room.flux;
		whole.area += room.area;
		addScaled( color, room.color, room.flux );
		whole.albedo.add( room.albedo );
		whole.floorAlbedo.add( room.floorAlbedo );
		if ( room.unseen ) {

			undrawn( 'down', room.unseen.down, room.unseen.downColor );
			undrawn( 'up', room.unseen.up, room.unseen.upColor );

		}

	}
	// A fixture published for a room the floor never built still hangs in the
	// building, so its flux belongs to the air the stair and the lobby stand in.
	for ( const fixture of orphans ) {

		flux += fixture.lumens;
		addScaled( color, fixture.color, fixture.lumens );
		undrawn( fixture.facing === 'up' ? 'up' : 'down', fixture.lumens, fixture.color );

	}

	if ( ! rooms.length ) return new THREE.Vector4();

	if ( flux > 0 ) color.multiplyScalar( 1 / flux );
	if ( unseen.down > 0 ) unseen.downColor.multiplyScalar( 1 / unseen.down );
	if ( unseen.up > 0 ) unseen.upColor.multiplyScalar( 1 / unseen.up );
	whole.albedo.multiplyScalar( 1 / rooms.length );
	whole.floorAlbedo.multiplyScalar( 1 / rooms.length );

	return RoomFill.perCopy( whole, flux, color, unseen );

}

/** A ring's extent on the ground, or a point where it publishes none. */
function extentOf( polygon, x, z ) {

	const rect = { x0: Infinity, z0: Infinity, x1: - Infinity, z1: - Infinity };

	for ( const [ px, pz ] of polygon ?? [] ) {

		rect.x0 = Math.min( rect.x0, px );
		rect.z0 = Math.min( rect.z0, pz );
		rect.x1 = Math.max( rect.x1, px );
		rect.z1 = Math.max( rect.z1, pz );

	}

	return rect.x1 >= rect.x0 ? rect : { x0: x, z0: z, x1: x, z1: z };

}

/**
 * The fixtures a floor published for a room it does not publish, the stair
 * cores above all: they hang in the building and light nothing unless the
 * floor takes them. They join the floor's shared pool and its haze, and their
 * room ids come back so the run can say which rooms were never built.
 */
export function floorOrphans( floor ) {

	const published = new Set( ( floor.rooms ?? [] ).map( ( room ) => room.id ) );
	const byRoom = fixturesByRoom( floor );
	const fixtures = [];
	const rooms = [];

	for ( const [ id, set ] of byRoom ) {

		if ( published.has( id ) ) continue;

		rooms.push( id );
		fixtures.push( ...set );

	}

	return { fixtures, rooms };

}

/**
 * The surface one storey of a room encloses: floor and ceiling, plus every
 * wall standing around its outline and around each hole in it.
 */
export function enclosure( polygon, holes, height ) {

	if ( ! polygon?.length ) return 0;

	const rings = [ polygon, ...( holes ?? [] ) ];
	const plan = Math.abs( ringArea( polygon ) ) - ( holes ?? [] ).reduce( ( sum, hole ) => sum + Math.abs( ringArea( hole ) ), 0 );
	const walls = rings.reduce( ( sum, ring ) => sum + ringLength( ring ), 0 ) * Math.max( 0, height );

	return Math.max( 0, 2 * plan + walls );

}

function ringArea( ring ) {

	let twice = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		twice += ax * bz - bx * az;

	}

	return twice / 2;

}

function ringLength( ring ) {

	let length = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		length += Math.hypot( bx - ax, bz - az );

	}

	return length;

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

const _up = new THREE.Color();
const _down = new THREE.Color();
const _part = new THREE.Color();

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
			// How far the surface it faces stands from it, which is both how far
			// its light has to carry and how much room its beam has to open in.
			reach: Math.max( 0, light.facing === 'up' ? floor.height - above : above ),
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
