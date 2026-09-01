import * as THREE from 'three/webgpu';
import { assembleRooms, geometryOf, outlinesOf, plain, reflectanceOf, OUTSIDE_FLOORS } from './InteriorRooms.js';
import { Haze } from '../light/Haze.js';

/** A building's interior is worth having in memory this close to its footprint. */
const LOAD_RADIUS = 70;
/** And is let go past this, with hysteresis so a boundary cannot thrash. */
const DROP_RADIUS = 95;
/** One building's interior at a time: the worker is one thread and the frame gets one landing. */
const CONCURRENCY = 1;
/** The published key whose geometry the lifts take their sliding leaves from. */
const ELEVATOR_DOOR = '/elevator_door/';
/** Floors above and below the one the player is on that stay in the scene. */
const BAND_REACH = 1;
/** Main-thread work a landing interior may take in one frame before the rest waits for the next. */
const FRAME_BUDGET_MS = 8;

/**
 * Interiors, streamed. A furnished tower is tens of megabytes and sixty floors
 * of geometry, and the player is only ever on one of them, so neither the file
 * nor the whole building belongs in the scene:
 *
 * - the interior GLB is fetched only while its building is within reach, and
 *   dropped again past a wider radius, so the city costs the buildings around
 *   the player rather than all of them;
 * - the fetch, the parse, the world-space bake and the cut into the rooms the
 *   interior box published and into floor bands all run in a worker
 *   (InteriorWorker.js); the frame only wraps the arrays it posts back;
 * - only the bands within one floor of the player are in the scene and in the
 *   physics world. Walking up the stairs moves the window.
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
	constructor( { factory, roomLights, haze, elevators, hitches = null } ) {

		this.factory = factory;
		this.hitches = hitches;
		this.roomLights = roomLights;
		this.haze = haze;
		this.elevators = elevators;
		this.worker = new InteriorWorkerLink();
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

	/** Lets every interior go and stops the worker. */
	dispose() {

		for ( const parcelId of [ ...this.live.keys() ] ) this.#drop( parcelId );

		this.worker.dispose();

	}

	/**
	 * Which floors of one building are in the scene. The player's own floor is
	 * whichever band holds their feet, so standing on the street puts the ground
	 * floor and its neighbours in and leaves the tower above out.
	 *
	 * A band going live costs a collider, so once a frame has spent its budget
	 * on them the rest wait: the pass is left unfinished and runs again next
	 * frame, picking up the bands that still differ from where the player is.
	 */
	#band( interior, feet ) {

		const standing = floorAt( interior.bands, feet.y );

		if ( standing === interior.standing ) return;

		const budget = new FrameBudget( FRAME_BUDGET_MS );

		for ( const band of interior.bands ) {

			const near = band.floor === OUTSIDE_FLOORS
				|| Math.abs( band.floor - standing ) <= BAND_REACH;

			if ( near === band.live ) continue;

			band.live = near;
			band.group.visible = near;
			this.changed = true;

			if ( ! near ) {

				this.onDropBand?.( band.id );
				continue;

			}

			const t = performance.now();
			this.onColliderBand?.( band.id, band.collider() );
			this.hitches?.note( `band ${band.id} collider`, performance.now() - t );

			if ( budget.spent ) return;

		}

		interior.standing = standing;

	}

	async #load( entry ) {

		this.loading ++;
		this.live.set( entry.parcelId, PLACEHOLDER );

		try {

			const built = await this.#build( entry );

			// A drop can have overtaken the load on a fast walk past a building.
			if ( ! built ) return;

			this.live.set( entry.parcelId, built );
			this.group.add( built.group );
			this.rooms.push( ...built.rooms );
			this.changed = true;

		} catch ( error ) {

			// A load nobody waits for any more fails quietly.
			if ( ! this.#waiting( entry ) ) return;

			this.live.delete( entry.parcelId );
			console.warn( `interior ${entry.parcelId}: ${error?.message ?? error}` );

		} finally {

			this.loading --;

		}

	}

	/** Whether the building is still wanted since its load began. */
	#waiting( entry ) {

		return this.live.get( entry.parcelId ) === PLACEHOLDER;

	}

	#drop( parcelId ) {

		const interior = this.live.get( parcelId );

		this.live.delete( parcelId );

		if ( interior === PLACEHOLDER ) return;

		for ( const band of interior.bands ) {

			if ( band.live ) this.onDropBand?.( band.id );

			band.dispose();

		}

		this.elevators?.remove( parcelId );
		this.group.remove( interior.group );
		this.rooms = this.rooms.filter( ( room ) => room.parcelId !== parcelId );
		this.changed = true;

	}

	/**
	 * Lands one interior: the worker cuts it, the frame assembles rooms and
	 * floor bands from what it posted, each step spread over as many frames as
	 * its budget takes and noted with its thread time.
	 *
	 * @returns the interior, or null when it stopped being wanted meanwhile
	 */
	async #build( entry ) {

		const sent = performance.now();
		const { cut, bytes, cost } = await this.worker.cut( entry );
		this.hitches?.note( `interior ${entry.parcelId} off thread ${( bytes / 1048576 ).toFixed( 1 )} MB: `
			+ `${Object.entries( cost ).map( ( [ step, ms ] ) => `${step} ${ms} ms` ).join( ', ' )}, `
			+ `round trip ${( performance.now() - sent ).toFixed( 0 )} ms` );

		if ( ! this.#waiting( entry ) ) return null;

		const reflectance = await this.#reflectance( keysOf( cut ) );

		if ( ! this.#waiting( entry ) ) return null;

		let budget = new FrameBudget( FRAME_BUDGET_MS );
		const rooms = [];

		for ( const room of assembleRooms( entry.parcelId, cut, entry.floors, reflectance ) ) {

			// A room is shown by distance and lit by the slot pool on separate
			// timers, so it enters the scene already dressed in the dim binding.
			room.wear( this.roomLights.dim, this.roomLights );
			rooms.push( room );

			if ( ! await this.#rest( budget, entry ) ) return null;

		}

		this.hitches?.note( `interior ${entry.parcelId} rooms ${budget.frames} frames`, budget.busy );

		budget = new FrameBudget( FRAME_BUDGET_MS );
		const group = new THREE.Group();
		group.name = `interior:${entry.parcelId}`;
		// Before the bands, because the door leaves each band gives up have to
		// know which shaft they belong to.
		this.elevators?.add( entry.parcelId, entry.floors, group );

		const levels = new Map( entry.floors.map( ( floor ) => [ floor.floor, floor ] ) );
		const bands = new Map();
		const bandOf = ( floor ) => {

			if ( ! bands.has( floor ) ) {

				const band = new FloorBand( entry.parcelId, floor, levels.get( floor ) );
				group.add( band.group );
				bands.set( floor, band );

			}

			return bands.get( floor );

		};

		for ( const { floor, surfaces } of cut.shared ) {

			const band = bandOf( floor );

			for ( const surface of surfaces ) {

				const material = this.roomLights.materialFor( this.roomLights.dim, surface.key );
				let geometry = geometryOf( surface );

				// The lift doors are published as geometry like everything else;
				// the shafts take theirs so they can slide.
				if ( surface.key.includes( ELEVATOR_DOOR ) ) {

					geometry = this.elevators?.claim( entry.parcelId, floor, geometry, material, band.group ) ?? geometry;

				}

				if ( geometry ) band.add( new THREE.Mesh( geometry, material ) );

			}

			if ( ! await this.#rest( budget, entry ) ) {

				this.elevators?.remove( entry.parcelId );
				return null;

			}

		}

		for ( const room of rooms ) bandOf( room.floor ).addRoom( room );

		const list = [ ...bands.values() ];
		this.#hangHaze( list, rooms );
		this.hitches?.note( `interior ${entry.parcelId} bands ${budget.frames} frames`, budget.busy );

		return { parcelId: entry.parcelId, center: entry.center, group, bands: list, rooms, standing: null };

	}

	/**
	 * Lets the frame go once the budget is spent.
	 * @returns whether the building is still wanted afterwards
	 */
	async #rest( budget, entry ) {

		await budget.rest();

		return this.#waiting( entry );

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
 * One floor of one interior: in the scene and solid while the player is
 * within a floor of it. Its collider is built the first time it goes live,
 * from the same arrays its meshes draw, so a tower's sixty other floors never
 * pay for one.
 */
class FloorBand {

	constructor( parcelId, floor, level ) {

		this.id = `${parcelId}:${floor}`;
		this.floor = floor;
		this.elevation = level?.elevation ?? 0;
		this.height = level?.height ?? 0;
		this.group = new THREE.Group();
		this.group.name = `interior:${parcelId}:floor:${floor}`;
		this.group.visible = false;
		this.live = false;
		this.solid = [];
		this.trimesh = null;

	}

	add( mesh ) {

		this.group.add( mesh );
		this.solid.push( mesh.geometry.getAttribute( 'position' ).array );

	}

	addRoom( room ) {

		room.group.visible = false;
		this.group.add( room.group );

		for ( const { mesh } of room.meshes ) this.solid.push( mesh.geometry.getAttribute( 'position' ).array );

	}

	/** Every solid surface of the floor as one position-only geometry, or null with none. */
	collider() {

		if ( this.trimesh || ! this.solid.length ) return this.trimesh;

		const merged = new Float32Array( this.solid.reduce( ( total, array ) => total + array.length, 0 ) );
		let at = 0;

		for ( const array of this.solid ) {

			merged.set( array, at );
			at += array.length;

		}

		this.trimesh = new THREE.BufferGeometry();
		this.trimesh.setAttribute( 'position', new THREE.BufferAttribute( merged, 3 ) );

		return this.trimesh;

	}

	dispose() {

		this.trimesh?.dispose();
		this.group.traverse( ( node ) => node.geometry?.dispose() );

	}

}

/**
 * The stream's side of the interior worker: one worker for the run, started
 * by the first load, one request answered at a time, terminated on dispose.
 * Stubbed in tests, which run where there is no Worker.
 */
class InteriorWorkerLink {

	constructor() {

		this.worker = null;
		this.waiting = new Map();
		this.serial = 0;

	}

	/** @returns { cut, bytes, cost } as InteriorWorker.js posts them */
	cut( entry ) {

		const id = this.serial ++;

		return new Promise( ( resolve, reject ) => {

			this.waiting.set( id, { resolve, reject } );
			this.#worker().postMessage( { id, url: entry.glbUrl, outlines: outlinesOf( entry.floors ) } );

		} );

	}

	dispose() {

		this.worker?.terminate();
		this.worker = null;
		this.#fail( 'interior stream disposed' );

	}

	#worker() {

		if ( this.worker ) return this.worker;

		this.worker = new Worker( new URL( './InteriorWorker.js', import.meta.url ), { type: 'module' } );
		this.worker.onmessage = ( { data } ) => {

			const request = this.waiting.get( data.id );

			this.waiting.delete( data.id );

			if ( data.error ) request?.reject( new Error( data.error ) );
			else request?.resolve( data );

		};
		this.worker.onerror = ( event ) => this.#fail( event.message || 'interior worker failed' );

		return this.worker;

	}

	#fail( message ) {

		for ( const request of this.waiting.values() ) request.reject( new Error( message ) );

		this.waiting.clear();

	}

}

/**
 * How much of a frame a landing interior may take. A loop checks in after
 * each piece of work; once the slice has run past the budget, the next piece
 * waits for the next frame. Keeps the thread time it took, over how many frames.
 */
class FrameBudget {

	constructor( ms ) {

		this.ms = ms;
		this.since = performance.now();
		this.rested = 0;
		this.frames = 1;

	}

	get spent() {

		return performance.now() - this.since >= this.ms;

	}

	/** Thread time spent so far, the waits between frames left out. */
	get busy() {

		return this.rested + performance.now() - this.since;

	}

	async rest() {

		if ( ! this.spent ) return;

		this.rested += performance.now() - this.since;
		await nextFrame();
		this.since = performance.now();
		this.frames ++;

	}

}

function nextFrame() {

	return new Promise( ( resolve ) => {

		if ( globalThis.requestAnimationFrame ) requestAnimationFrame( resolve );
		else setTimeout( resolve );

	} );

}

/** Every material key a cut carries. */
function keysOf( cut ) {

	const keys = new Set();

	for ( const owner of [ ...cut.rooms, ...cut.shared ] ) {

		for ( const surface of owner.surfaces ) keys.add( surface.key );

	}

	return keys;

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
