import * as THREE from 'three/webgpu';
import { fill, pointInRing } from '../ground/Polygons.js';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { kelvinColor } from '../light/Color.js';
import { frameOf } from './StationFrame.js';
import { box, merge, solid, wall } from './Shapes.js';

/** How far the wall around a shaft mouth stands above the pavement. */
const PARAPET = 1;
/** One flight's clear width, and the landing at each turn. */
const FLIGHT = 1.15;
const LANDING = 1.3;
const GOING = 0.3;
/** No tread rises more than this; the controller autosteps 0.42 m. */
const MAX_RISE = 0.19;
/** Head height in a passage, capped by the station box it runs inside. */
const PASSAGE_HEIGHT = 3;
/**
 * Two volumes meet exactly on a shared edge, so an opening test at that edge
 * lands on the boundary and answers neither way. Every ring is grown by this
 * much before it is asked, which opens the join and nothing else.
 */
const JOIN = 0.2;
/** A canopy over a platform at grade, and how far apart its posts stand. */
const POST = 0.22;
const POST_SPACING = 12;

const STRUCTURE_KEY = 'cyberpunk/concrete/rich';
const FLOOR_KEY = 'cyberpunk/tile/mid';

/** A station is unlit rock without these: strip fixtures down the platform and one over each landing. */
const LAMP_KELVIN = 4200;
const PLATFORM_LUMENS = 2600;
const PLATFORM_RANGE = 18;
const PLATFORM_SPACING = 14;
const SHAFT_LUMENS = 900;
const SHAFT_RANGE = 9;

/**
 * The station itself: the shaft under every entrance, the passage at its foot
 * and the platform room it opens into, straight off the atlas volumes
 * (`Station.box`, `Station.shafts[].footprint/top/bottom/passage`,
 * `Station.platform`). Connections keeps its tunnels and links clear of these,
 * so the space inside them is this box's.
 *
 * A shaft is a well on its own published footprint with a switchback stair
 * inside it. How many flights and how high each tread rises is worked out from
 * the depth and the footprint rather than authored, so a 12 m shaft in an 8 m
 * box gets four flights at 0.168 m and a shallower one gets fewer: no tread is
 * ever outside what the character controller can step.
 *
 * A shaft that stands inside its platform drops straight into the room through
 * a hole in its ceiling. One that stands outside is joined to it by the passage
 * the atlas publishes, and the walls of both open where they meet.
 *
 * A platform at or above grade (a surface train station) is already the city
 * floor, so it gets a canopy on posts instead of a room.
 */
export class StationVolumes {

	/**
	 * @param atlas CityBlueprint per ../../../../atlas/CONTRACT.md
	 * @param factory PbrMaterialFactory
	 */
	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	/** @returns { group, glows, collider } */
	build() {

		const group = new THREE.Group();
		group.name = 'station-volumes';

		const structure = [];
		const floors = [];
		const glows = [];

		for ( const station of stations( this.atlas ) ) {

			if ( ! station.platform?.length || ! station.box ) continue;

			if ( station.box.bottom >= 0 ) this.#canopy( station, structure );
			else this.#room( station, structure, floors, glows );

			for ( const shaft of station.shafts ?? [] ) this.#shaft( station, shaft, structure, floors, glows );

		}

		// A wall that is open end to end builds nothing, and a station with no
		// volumes at all builds none of it.
		const walls = structure.filter( Boolean );
		const slabs = floors.filter( Boolean );

		this.#add( group, 'station:structure', walls, STRUCTURE_KEY );
		this.#add( group, 'station:floor', slabs, FLOOR_KEY );

		return { group, glows, collider: solid( [ ...walls, ...slabs ] ) };

	}

	/** One merged mesh per key, drawn from both sides: a wall here has no thickness. */
	#add( group, name, geometries, key ) {

		const merged = merge( geometries );

		if ( ! merged ) return;

		const mesh = new THREE.Mesh( merged, this.factory.variant( key, { side: THREE.DoubleSide } ) );
		mesh.name = name;
		mesh.receiveShadow = true;
		group.add( mesh );

	}

	/** The platform room: floor, ceiling holed where a shaft comes through, walls opened where a passage lands. */
	#room( station, structure, floors, glows ) {

		const { platform, box: volume } = station;
		const holes = ( station.shafts ?? [] )
			.map( ( shaft ) => shaft.footprint )
			.filter( ( footprint ) => footprint?.length >= 3 && inside( footprint, platform ) );
		const ways = passages( station ).map( ( way ) => grow( way, JOIN ) );

		floors.push( fill( platform, volume.bottom ) );
		structure.push( fill( platform, volume.top, holes ) );
		structure.push( wall( platform, volume.top, volume.bottom, ( x, z ) => ways.some( ( way ) => pointInRing( x, z, way ) ) ) );

		const frame = frameOf( platform );
		const lamps = Math.max( 1, Math.round( frame.long / PLATFORM_SPACING ) );

		for ( let i = 0; i < lamps; i ++ ) {

			const along = frame.long * ( ( i + 0.5 ) / lamps - 0.5 );
			const [ x, z ] = frame.at( along, 0 );

			glows.push( {
				position: new THREE.Vector3( x, volume.top - 0.35, z ),
				color: kelvinColor( LAMP_KELVIN ), lumens: PLATFORM_LUMENS, range: PLATFORM_RANGE
			} );

		}

	}

	/** A platform already at street level: a roof on posts rather than a room. */
	#canopy( station, structure ) {

		const { platform, box: volume } = station;
		const frame = frameOf( platform );

		if ( ! frame ) return;

		structure.push( fill( platform, volume.top ) );

		const bays = Math.max( 2, Math.round( frame.long / POST_SPACING ) );
		const reach = frame.short / 2 - POST;

		for ( let i = 0; i <= bays; i ++ ) {

			const along = frame.long * ( i / bays - 0.5 ) * 0.98;

			for ( const off of [ - reach, reach ] ) {

				const [ x, z ] = frame.at( along, off );
				const post = box( POST, volume.top - volume.bottom, POST );
				post.translate( x, ( volume.bottom + volume.top ) / 2, z );
				structure.push( post );

			}

		}

	}

	/** One shaft: the parapet at the mouth, the well, the stair down it, and its passage. */
	#shaft( station, shaft, structure, floors, glows ) {

		const frame = frameOf( shaft.footprint ?? [] );

		if ( ! frame || ! ( shaft.bottom < shaft.top ) ) return;

		const way = shaft.passage?.length >= 3 ? shaft.passage : null;
		// A shaft standing in its own platform ends at the room's ceiling and
		// drops into it; one standing outside is walled to its own floor.
		const within = inside( shaft.footprint, station.platform );
		const foot = within ? station.box.top : shaft.bottom;
		const mouth = SIDEWALK_HEIGHT;
		const plan = stairPlan( frame.long, mouth, shaft.bottom );

		// The mouth is the way in, so the parapet stops short of the end the
		// first flight starts from; below the pavement the well is closed all
		// round except where its passage leaves it.
		structure.push( wall( shaft.footprint, mouth + PARAPET, mouth, ( x, z ) => frame.along( x, z ) < - plan.run / 2 ) );
		const opening = way && grow( way, JOIN );
		structure.push( wall( shaft.footprint, mouth, foot, ( x, z ) => opening !== null && pointInRing( x, z, opening ) ) );

		this.#stair( frame, { mouth, ...plan }, floors, structure, glows );

		if ( way ) this.#passage( station, shaft, way, floors, structure, glows );

	}

	/** The switchback: alternating flights on their own side of the well, a landing at every turn. */
	#stair( frame, { mouth, treads, flights, rise, run }, floors, structure, glows ) {

		const lane = frame.short / 4;
		const width = Math.min( FLIGHT, frame.short / 2 - 0.05 );

		for ( let k = 0; k <= flights; k ++ ) {

			// Landings stack at alternating ends, the first one flush with the pavement.
			const end = ( k % 2 === 0 ? - 1 : 1 ) * ( run / 2 + LANDING / 2 );
			const y = mouth - k * treads * rise;
			const [ lx, lz ] = frame.at( end, 0 );
			const slab = box( frame.short, 0.2, LANDING );
			slab.rotateY( frame.heading );
			slab.translate( lx, y - 0.1, lz );
			floors.push( slab );

			glows.push( {
				position: new THREE.Vector3( lx, y + 2.3, lz ),
				color: kelvinColor( LAMP_KELVIN ), lumens: SHAFT_LUMENS, range: SHAFT_RANGE
			} );

			if ( k === flights ) break;

			const direction = k % 2 === 0 ? 1 : - 1;
			const off = direction * lane;

			for ( let i = 0; i < treads; i ++ ) {

				const along = direction * ( - run / 2 + ( i + 0.5 ) * GOING );
				const [ tx, tz ] = frame.at( along, off );
				const tread = box( width, rise, GOING );
				tread.rotateY( frame.heading );
				tread.translate( tx, y - ( i + 0.5 ) * rise, tz );
				floors.push( tread );

			}

		}

	}

	/** The corridor from a shaft's foot to the platform, open at both ends. */
	#passage( station, shaft, way, floors, structure, glows ) {

		const floor = station.box.bottom;
		const top = Math.min( floor + PASSAGE_HEIGHT, station.box.top );

		floors.push( fill( way, floor ) );
		structure.push( fill( way, top ) );
		const ends = [ grow( shaft.footprint, JOIN ), grow( station.platform, JOIN ) ];
		structure.push( wall( way, top, floor, ( x, z ) => ends.some( ( ring ) => pointInRing( x, z, ring ) ) ) );

		const [ cx, cz ] = frameOf( way ).centre;

		glows.push( {
			position: new THREE.Vector3( cx, top - 0.3, cz ),
			color: kelvinColor( LAMP_KELVIN ), lumens: SHAFT_LUMENS, range: SHAFT_RANGE
		} );

	}

}

/**
 * The switchback that fits a drop into a footprint: as many treads as one
 * flight of the long axis holds, then as many flights as the drop needs at no
 * more than `MAX_RISE` a tread, then the rise spread evenly over all of them.
 * Nothing here is authored: a 12 m shaft in an 8 m box comes out four flights
 * of eighteen at 0.168 m, and a shallower one fewer.
 *
 * @returns { treads, flights, rise, run } run being one flight's length
 */
export function stairPlan( long, top, bottom ) {

	const treads = Math.max( 1, Math.floor( ( long - 2 * LANDING ) / GOING ) );
	const drop = top - bottom;
	const flights = Math.max( 1, Math.ceil( drop / ( treads * MAX_RISE ) ) );

	return { treads, flights, rise: drop / ( flights * treads ), run: treads * GOING };

}

/** Both modes' stations in one pass. */
export function stations( atlas ) {

	return [
		...( atlas.transit?.trainStations ?? [] ),
		...( atlas.transit?.subwayStations ?? [] )
	];

}

/** Every passage a station publishes, whichever shaft it belongs to. */
function passages( station ) {

	return ( station.shafts ?? [] ).map( ( shaft ) => shaft.passage ).filter( ( way ) => way?.length >= 3 );

}

/** A ring pushed `metres` outward from its own middle, so a shared edge falls inside it. */
function grow( ring, metres ) {

	const [ cx, cz ] = middle( ring );

	return ring.map( ( [ x, z ] ) => {

		const dx = x - cx;
		const dz = z - cz;
		const length = Math.hypot( dx, dz ) || 1;

		return [ x + ( dx / length ) * metres, z + ( dz / length ) * metres ];

	} );

}

function middle( ring ) {

	let x = 0;
	let z = 0;

	for ( const [ px, pz ] of ring ) {

		x += px / ring.length;
		z += pz / ring.length;

	}

	return [ x, z ];

}

/** Whether a footprint's middle stands inside a ring. */
function inside( footprint, ring ) {

	if ( ! ring?.length ) return false;

	const [ x, z ] = middle( footprint );

	return pointInRing( x, z, ring );

}
