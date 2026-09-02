import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { kelvinColor } from '../light/Color.js';

/** The parcel types that are places to go into rather than places to live. */
const VENUE_TYPES = new Set( [
	'commerce', 'mall', 'restaurant', 'coffee_shop', 'hotel', 'clinic', 'hospital', 'police'
] );

/** How far out a venue's open state is worth asking the simulation about. */
const ASK_RADIUS = 140;
/** And how often. A rota changes on the hour, never between two frames. */
const ASK_INTERVAL = 4;

const FRAME_KEY = 'cyberpunk/light-fixture/mid';
const FRAME_KELVIN = 3200;
/** A door frame strip is read directly, so it sits above street exposure. */
const FRAME_EMISSIVE = 30;
const FRAME_WIDTH = 0.07;
const FRAME_INSET = 0.06;

/**
 * Which buildings are real, said in light.
 *
 * The playtest complaint this answers is "I just do not know which ones are
 * real". A building the world actually built has a way in, and now it says so:
 * a thin lit strip runs up both sides of its door frame and over the head, and
 * the entrance fixture the exterior box put there is lit. A parcel with no
 * interior behind it has no door, so it gets neither, and never offers a
 * prompt. Nothing floats: every marker is a fixture on a real surface.
 *
 * A venue's sign follows the simulation rather than the clock: it is lit while
 * somebody is on duty in there, and dark when the place has shut. The whole
 * city's strips are one merged mesh, so the legibility costs one draw call.
 */
export class Venues {

	/**
	 * @param atlas CityBlueprint
	 * @param buildings Map<parcelId, ...>, the parcels with an interior
	 * @param doors the entrance doors the shells gave up
	 * @param fixtures the city fixture list, in the order CityLights holds it
	 */
	constructor( { atlas, buildings, doors, fixtures, factory } ) {

		this.factory = factory;
		this.timer = ASK_INTERVAL;
		this.venues = [];

		const byParcel = new Map( doors.map( ( door ) => [ door.parcelId, door ] ) );
		const signs = new Map();

		fixtures.forEach( ( fixture, index ) => {

			if ( fixture.kind !== 'sign' ) return;

			if ( ! signs.has( fixture.parcelId ) ) signs.set( fixture.parcelId, [] );

			signs.get( fixture.parcelId ).push( index );

		} );

		for ( const parcel of atlas.parcels ) {

			const door = byParcel.get( parcel.id );

			if ( ! door || ! buildings.has( parcel.id ) ) continue;

			door.name = nameOf( buildings.get( parcel.id ) );

			this.venues.push( {
				parcelId: parcel.id,
				venue: VENUE_TYPES.has( parcel.type ),
				name: door.name,
				point: door.outside.clone(),
				signs: signs.get( parcel.id ) ?? [],
				open: true
			} );

		}

	}

	/** Every enterable venue, for the minimap to mark. */
	get marks() {

		return this.venues.filter( ( entry ) => entry.venue );

	}

	/**
	 * The lit strip around every real entrance, as one mesh for the city.
	 * @param doors the same doors the constructor was given
	 */
	build( doors ) {

		const group = new THREE.Group();
		group.name = 'entrances';
		const strips = [];

		for ( const door of doors ) strips.push( ...frameStrip( door ) );

		if ( strips.length ) {

			group.add( new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( strips, false ),
				this.factory.variant( FRAME_KEY, {
					emissiveScale: FRAME_EMISSIVE,
					emissive: kelvinColor( FRAME_KELVIN )
				} )
			) );

		}

		return group;

	}

	/**
	 * Asks the simulation who is on duty in the venues around the player and
	 * switches their signs. Cheap because it runs on a timer over a radius, not
	 * every frame over the city.
	 */
	update( delta, feet, timeMin, sim, lights ) {

		this.timer += delta;

		if ( this.timer < ASK_INTERVAL ) return;

		this.timer = 0;

		for ( const entry of this.venues ) {

			if ( ! entry.venue || ! entry.signs.length ) continue;

			if ( entry.point.distanceTo( feet ) > ASK_RADIUS ) continue;

			const open = staffed( sim, entry.parcelId, timeMin );

			if ( open === entry.open ) continue;

			entry.open = open;

			for ( const index of entry.signs ) lights.setFixtureDim( index, open ? 1 : 0 );

		}

	}

}

/** Open means somebody is working in there right now, not a published timetable. */
function staffed( sim, parcelId, timeMin ) {

	try {

		const slice = sim.crowd( timeMin, { kind: 'parcel', id: parcelId } );

		return ( slice?.agents?.length ?? 0 ) > 0;

	} catch {

		return false;

	}

}

/** What the sign over this door says, which is what the prompt calls the place. */
function nameOf( building ) {

	const sign = ( building.blueprint?.signage ?? [] ).find( ( entry ) => entry.text );

	return sign?.text ?? null;

}

/**
 * Two jambs and a head, standing just proud of the facade around the opening,
 * built in the door's own frame (along the opening, out of it) so a facade at
 * any angle gets its strips on the frame and not on the world axes.
 */
function frameStrip( door ) {

	const yaw = Math.atan2( - door.along.z, door.along.x );
	const y0 = door.center.y;
	const out = [];

	const bar = ( length, height, offset, y ) => {

		const geometry = new THREE.BoxGeometry( length, height, FRAME_WIDTH );
		geometry.deleteAttribute( 'uv1' );
		geometry.rotateY( yaw );
		geometry.translate(
			door.center.x + door.along.x * offset + door.normal.x * FRAME_INSET,
			y,
			door.center.z + door.along.z * offset + door.normal.z * FRAME_INSET
		);
		out.push( geometry.toNonIndexed() );

	};

	for ( const side of [ - 1, 1 ] ) bar( FRAME_WIDTH, door.height, side * door.width / 2, y0 + door.height / 2 );

	bar( door.width + FRAME_WIDTH, FRAME_WIDTH, 0, y0 + door.height );

	return out;

}

