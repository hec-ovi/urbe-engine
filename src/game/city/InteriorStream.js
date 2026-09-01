import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildRooms, reflectanceOf, OUTSIDE_FLOORS } from './InteriorRooms.js';
import { bake, positionsOnly, INTERIOR_PREFIX } from './BuildingsLoader.js';
import { Haze } from '../light/Haze.js';

/** A building's interior is worth having in memory this close to its footprint. */
const LOAD_RADIUS = 70;
/** And is let go past this, with hysteresis so a boundary cannot thrash. */
const DROP_RADIUS = 95;
/** One building's interior at a time: a 12 MB parse must not stall a frame run. */
const CONCURRENCY = 1;
/** The published key whose geometry the lifts take their sliding leaves from. */
const ELEVATOR_DOOR = '/elevator_door/';
/** Floors above and below the one the player is on that stay in the scene. */
const BAND_REACH = 1;

/**
 * Interiors, streamed. A furnished tower is tens of megabytes and sixty floors
 * of geometry, and the player is only ever on one of them, so neither the file
 * nor the whole building belongs in the scene:
 *
 * - the interior GLB is fetched only while its building is within reach, and
 *   dropped again past a wider radius, so the city costs the buildings around
 *   the player rather than all of them;
 * - what comes back is cut into the rooms the interior box published and into
 *   floor bands, and only the bands within one floor of the player are in the
 *   scene and in the physics world. Walking up the stairs moves the window.
 *
 * The shells are not here: they load once for the whole city (BuildingsLoader)
 * because the skyline is visible from everywhere.
 */
export class InteriorStream {

	/**
	 * @param factory PbrMaterialFactory, for the reflectance of each key
	 * @param roomLights RoomLights, which owns every interior material
	 * @param haze { spread, cap } for the air inside a room, or null at tiers
	 * that do not draw it
	 */
	constructor( { factory, roomLights, haze, elevators } ) {

		this.factory = factory;
		this.roomLights = roomLights;
		this.haze = haze;
		this.elevators = elevators;
		this.loader = new GLTFLoader();
		this.group = new THREE.Group();
		this.group.name = 'interiors';
		this.pending = new Map();
		this.live = new Map();
		this.loading = 0;
		this.rooms = [];
		this.onColliderBand = null;
		this.onDropBand = null;
		this.changed = false;

	}

	/** @param buildings Map<parcelId, { glbUrl, floors }> plus a footprint centre */
	register( buildings, centers ) {

		for ( const [ parcelId, building ] of buildings ) {

			this.pending.set( parcelId, {
				parcelId,
				glbUrl: building.glbUrl,
				floors: building.floors,
				center: centers.get( parcelId )
			} );

		}

	}

	get liveInteriors() {

		return this.live.size;

	}

	/**
	 * One pass over what should be in memory and what should be in the scene.
	 * Cheap to call every frame: the distance test is a hypot per building and
	 * the band test only runs on what is loaded.
	 */
	update( feet ) {

		this.changed = false;

		// Nearest first: the building being walked into is the one whose rooms
		// have to be there, and a queue in map order would load the far side of
		// the block ahead of it.
		if ( this.loading < CONCURRENCY ) {

			let next = null;
			let nearest = LOAD_RADIUS;

			for ( const entry of this.pending.values() ) {

				if ( this.live.has( entry.parcelId ) ) continue;

				const distance = ground( entry.center, feet );

				if ( distance < nearest ) {

					nearest = distance;
					next = entry;

				}

			}

			if ( next ) this.#load( next );

		}

		for ( const [ parcelId, interior ] of this.live ) {

			// A load in flight has no geometry to band and no centre to measure;
			// it is dropped or kept once it lands.
			if ( interior === PLACEHOLDER ) continue;

			if ( ground( interior.center, feet ) > DROP_RADIUS ) this.#drop( parcelId );
			else this.#band( interior, feet );

		}

		return this.changed;

	}

	/**
	 * Which floors of one building are in the scene. The player's own floor is
	 * whichever band holds their feet, so standing on the street puts the ground
	 * floor and its neighbours in and leaves the tower above out.
	 */
	#band( interior, feet ) {

		const standing = floorAt( interior.bands, feet.y );

		if ( standing === interior.standing ) return;

		interior.standing = standing;

		for ( const band of interior.bands ) {

			const near = band.floor === OUTSIDE_FLOORS
				|| Math.abs( band.floor - standing ) <= BAND_REACH;

			if ( near === band.live ) continue;

			band.live = near;
			band.group.visible = near;

			if ( near ) this.onColliderBand?.( band.id, band.collider );
			else this.onDropBand?.( band.id );

		}

		this.changed = true;

	}

	async #load( entry ) {

		this.loading ++;
		this.live.set( entry.parcelId, PLACEHOLDER );

		try {

			const built = await this.#build( entry );

			// A drop can have overtaken the load on a fast walk past a building.
			if ( this.live.get( entry.parcelId ) !== PLACEHOLDER ) return;

			this.live.set( entry.parcelId, built );
			this.group.add( built.group );
			this.rooms.push( ...built.rooms );
			built.standing = null;
			this.changed = true;

		} catch ( error ) {

			this.live.delete( entry.parcelId );
			console.warn( `interior ${entry.parcelId}: ${error?.message ?? error}` );

		} finally {

			this.loading --;

		}

	}

	#drop( parcelId ) {

		const interior = this.live.get( parcelId );

		this.live.delete( parcelId );

		if ( interior === PLACEHOLDER ) return;

		for ( const band of interior.bands ) {

			if ( band.live ) this.onDropBand?.( band.id );

			band.collider?.dispose();
			band.group.traverse( ( node ) => node.geometry?.dispose() );

		}

		this.elevators?.remove( parcelId );
		this.group.remove( interior.group );
		this.rooms = this.rooms.filter( ( room ) => room.parcelId !== parcelId );
		this.changed = true;

	}

	/** Reads one interior GLB and cuts it into rooms and floor bands. */
	async #build( entry ) {

		const gltf = await this.loader.loadAsync( entry.glbUrl );
		gltf.scene.updateMatrixWorld( true );

		const byKey = new Map();

		gltf.scene.traverse( ( node ) => {

			if ( ! node.isMesh || ! node.name?.startsWith( INTERIOR_PREFIX ) ) return;

			const key = materialKey( node.material );

			if ( ! byKey.has( key ) ) byKey.set( key, [] );

			byKey.get( key ).push( bake( node ) );

		} );

		const reflectance = await this.#reflectance( byKey.keys() );
		const cut = buildRooms( entry.parcelId, byKey, entry.floors, reflectance );
		const group = new THREE.Group();
		group.name = `interior:${entry.parcelId}`;
		// Before the bands, because the door leaves each band gives up have to
		// know which shaft they belong to.
		this.elevators?.add( entry.parcelId, entry.floors, group );

		const levels = new Map( entry.floors.map( ( floor ) => [ floor.floor, floor ] ) );
		const bands = new Map();
		const bandOf = ( floor ) => {

			if ( ! bands.has( floor ) ) {

				const inner = new THREE.Group();
				inner.name = `${group.name}:floor:${floor}`;
				inner.visible = false;
				group.add( inner );
				bands.set( floor, {
					id: `${entry.parcelId}:${floor}`,
					floor,
					elevation: levels.get( floor )?.elevation ?? 0,
					height: levels.get( floor )?.height ?? 0,
					group: inner,
					flat: [],
					live: false
				} );

			}

			return bands.get( floor );

		};

		for ( const [ floor, keys ] of cut.shared ) {

			const band = bandOf( floor );

			for ( const [ key, geometries ] of keys ) {

				const material = this.roomLights.materialFor( this.roomLights.dim, key );
				let merged = BufferGeometryUtils.mergeGeometries( geometries, false );
				geometries.forEach( ( g ) => g.dispose() );

				// The lift doors are published as geometry like everything else;
				// the shafts take theirs so they can slide.
				if ( key.includes( ELEVATOR_DOOR ) ) {

					merged = this.elevators?.claim( entry.parcelId, floor, merged, material, band.group ) ?? merged;

				}

				if ( ! merged ) continue;

				band.flat.push( positionsOnly( merged ) );
				band.group.add( new THREE.Mesh( merged, material ) );

			}

		}

		for ( const room of cut.rooms ) {

			const band = bandOf( room.floor );

			room.group.visible = false;
			band.group.add( room.group );

			for ( const { mesh } of room.meshes ) band.flat.push( positionsOnly( mesh.geometry ) );

		}

		const list = [ ...bands.values() ];

		for ( const band of list ) {

			band.collider = band.flat.length ? BufferGeometryUtils.mergeGeometries( band.flat, false ) : null;
			band.flat.forEach( ( g ) => g.dispose() );
			delete band.flat;

		}

		this.#hangHaze( list, cut.rooms );

		return { parcelId: entry.parcelId, center: entry.center, group, bands: list, rooms: cut.rooms };

	}

	/**
	 * The air inside the rooms of one floor, as geometry, parented to that
	 * band so it is culled with the floor it belongs to.
	 */
	#hangHaze( bands, rooms ) {

		if ( ! this.haze ) return;

		for ( const band of bands ) {

			const fixtures = rooms
				.filter( ( room ) => room.floor === band.floor )
				.flatMap( ( room ) => room.fixtures );
			const glow = Haze.build( fixtures, this.haze );

			if ( glow ) band.group.add( glow );

		}

	}

	/** Reflectance per key: level from what the surface is, hue from its map. */
	async #reflectance( keys ) {

		const tints = new Map( await Promise.all(
			[ ...keys ].map( async ( key ) => [ key, await this.factory.tint( plain( key ) ) ] )
		) );

		return ( key ) => reflectanceOf( plain( key ), tints.get( key ) );

	}

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

/** The variant a bucket key asks for, or undefined. */
export function variantOf( key ) {

	return key.split( '#' )[ 1 ];

}

/**
 * The floor whose slab-to-slab band holds `y`, or the nearest one when the
 * player is outside the building altogether, which is the usual case: standing
 * on the pavement puts you on floor 0 and its neighbours.
 */
export function floorAt( bands, y ) {

	let best = null;
	let bestGap = Infinity;

	for ( const band of bands ) {

		if ( band.floor === OUTSIDE_FLOORS ) continue;

		const top = band.elevation + band.height;

		if ( y >= band.elevation && y < top ) return band.floor;

		const gap = y < band.elevation ? band.elevation - y : y - top;

		if ( gap < bestGap ) {

			bestGap = gap;
			best = band.floor;

		}

	}

	return best ?? 0;

}

function ground( center, point ) {

	return Math.hypot( center.x - point.x, center.z - point.z );

}

/** Held while a load is in flight so the same building is not fetched twice. */
const PLACEHOLDER = Object.freeze( { placeholder: true } );
