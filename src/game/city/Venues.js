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

const HEADER_HOUSING_KEY = 'cyberpunk/window-frame/mid';
const HEADER_KELVIN = 3200;
/** A compact header fixture identifies an entrance with a playable interior. */
const HEADER_EMISSIVE = 35;
const HEADER_HOUSING_WIDTH = 0.11;
const HEADER_LIGHT_WIDTH = 0.045;
const HEADER_DEPTH = 0.05;
const HEADER_CLEARANCE = 0.003;
const DEFAULT_SURFACE_DEPTH = 0.08;
/** Dark fitted end cap at each end of a continuous light bar. */
const HEADER_END_CAP = 0.055;

/** Entrance header lights identify playable interiors; venue signs follow staffing. */
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
	 * Compact header fixtures, merged into one housing and one lens draw.
	 * @param doors the same doors the constructor was given
	 */
	build( doors ) {

		const group = new THREE.Group();
		group.name = 'entrances';
		const housings = [];
		const lenses = [];

		for ( const door of doors ) {

			const frame = headerFixture( door );
			housings.push( ...frame.housings );
			lenses.push( ...frame.lenses );

		}

		if ( housings.length ) {

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( housings, false ),
				this.factory.build( HEADER_HOUSING_KEY )
			);
			mesh.name = 'entrance-header:housing';
			group.add( mesh );

		}

		if ( lenses.length ) {

			const mesh = new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( lenses, false ),
				headerLightMaterial()
			);
			mesh.name = 'entrance-header:lens';
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
function headerLightMaterial() {

	const color = kelvinColor( HEADER_KELVIN );

	return new THREE.MeshStandardMaterial( {
		name: 'entrance-header:light',
		color,
		emissive: color,
		emissiveIntensity: HEADER_EMISSIVE,
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

/** A short centered lamp fitted above the entrance in its own facade frame. */
function headerFixture( door ) {

	const yaw = Math.atan2( door.normal.x, door.normal.z );
	const rear = ( door.surfaceDepth ?? DEFAULT_SURFACE_DEPTH ) + HEADER_CLEARANCE;
	const length = Math.min( 1.2, door.width * 0.45 );
	const y = door.center.y + door.height + HEADER_HOUSING_WIDTH / 2;
	const housing = new THREE.BoxGeometry( length, HEADER_HOUSING_WIDTH, HEADER_DEPTH );
	housing.deleteAttribute( 'uv1' );
	housing.rotateY( yaw );
	housing.translate(
		door.center.x + door.normal.x * ( rear + HEADER_DEPTH / 2 ), y,
		door.center.z + door.normal.z * ( rear + HEADER_DEPTH / 2 )
	);
	const lens = new THREE.PlaneGeometry( Math.max( HEADER_LIGHT_WIDTH, length - HEADER_END_CAP * 2 ), HEADER_LIGHT_WIDTH );
	lens.deleteAttribute( 'uv1' );
	lens.rotateY( yaw );
	lens.translate(
		door.center.x + door.normal.x * ( rear + HEADER_DEPTH + 0.001 ), y,
		door.center.z + door.normal.z * ( rear + HEADER_DEPTH + 0.001 )
	);
	const result = { housings: [ housing.toNonIndexed() ], lenses: [ lens.toNonIndexed() ] };
	housing.dispose();
	lens.dispose();
	return result;

}
