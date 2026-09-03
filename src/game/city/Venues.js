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

const FRAME_HOUSING_KEY = 'cyberpunk/window-frame/mid';
const FRAME_KELVIN = 3200;
/** A door frame strip is read directly, so it sits above street exposure. */
const FRAME_EMISSIVE = 90;
const FRAME_HOUSING_WIDTH = 0.11;
const FRAME_LIGHT_WIDTH = 0.045;
const FRAME_DEPTH = 0.05;
const FRAME_CLEARANCE = 0.003;
const DEFAULT_SURFACE_DEPTH = 0.08;
/** Dark fitted end cap at each end of a continuous light bar. */
const FRAME_END_CAP = 0.055;

/**
 * Which buildings are real, said in light.
 *
 * The playtest complaint this answers is "I just do not know which ones are
 * real". A building with an interior has a way in, and now it says so:
 * a thin lit strip runs up both sides of its door frame and over the head, and
 * the entrance fixture the exterior box put there is lit. A parcel with no
 * interior behind it keeps its door shut, so it gets neither, and never offers a
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
		const housings = [];
		const lenses = [];

		for ( const door of doors ) {

			const frame = frameStrip( door );
			housings.push( ...frame.housings );
			lenses.push( ...frame.lenses );

		}

		if ( housings.length ) {

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( housings, false ),
				this.factory.build( FRAME_HOUSING_KEY )
			);
			mesh.name = 'entrance-frame:housing';
			group.add( mesh );

		}

		if ( lenses.length ) {

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( lenses, false ),
				frameLightMaterial()
			);
			mesh.name = 'entrance-frame:lens';
			group.add( mesh );

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

/** A continuous emitter has no repeated fixture map, mask, or bezel. */
function frameLightMaterial() {

	const color = kelvinColor( FRAME_KELVIN );

	return new THREE.MeshStandardMaterial( {
		name: 'entrance-frame:light',
		color,
		emissive: color,
		emissiveIntensity: FRAME_EMISSIVE,
		roughness: 0.45,
		metalness: 0
	} );

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
export function frameStrip( door ) {

	const yaw = Math.atan2( door.normal.x, door.normal.z );
	const y0 = door.center.y;
	const housings = [];
	const lenses = [];
	const rear = ( door.surfaceDepth ?? DEFAULT_SURFACE_DEPTH ) + FRAME_CLEARANCE;

	const bar = ( length, height, lensWidth, lensHeight, offset, y ) => {

		const housing = new THREE.BoxGeometry( length, height, FRAME_DEPTH );
		housing.deleteAttribute( 'uv1' );
		housing.rotateY( yaw );
		housing.translate(
			door.center.x + door.along.x * offset + door.normal.x * ( rear + FRAME_DEPTH / 2 ),
			y,
			door.center.z + door.along.z * offset + door.normal.z * ( rear + FRAME_DEPTH / 2 )
		);
		housings.push( housing.toNonIndexed() );

		// The emitting surface is one fitted face, not the six faces of a box.
		// Its uniform `strip` variant can repeat over any valid door size without
		// repeating the dark bezel of the canonical lamp texture through the bar.
		const lens = new THREE.PlaneGeometry( lensWidth, lensHeight );
		lens.deleteAttribute( 'uv1' );
		lens.rotateY( yaw );
		lens.translate(
			door.center.x + door.along.x * offset + door.normal.x * ( rear + FRAME_DEPTH + 0.001 ),
			y,
			door.center.z + door.along.z * offset + door.normal.z * ( rear + FRAME_DEPTH + 0.001 )
		);
		lenses.push( lens.toNonIndexed() );

	};

	for ( const side of [ - 1, 1 ] ) {

		bar(
			FRAME_HOUSING_WIDTH, door.height,
			FRAME_LIGHT_WIDTH, Math.max( FRAME_LIGHT_WIDTH, door.height - FRAME_END_CAP * 2 ),
			side * door.width / 2, y0 + door.height / 2
		);

	}

	bar(
		door.width + FRAME_HOUSING_WIDTH, FRAME_HOUSING_WIDTH,
		Math.max( FRAME_LIGHT_WIDTH, door.width + FRAME_HOUSING_WIDTH - FRAME_END_CAP * 2 ), FRAME_LIGHT_WIDTH,
		0, y0 + door.height
	);

	return { housings, lenses };

}
