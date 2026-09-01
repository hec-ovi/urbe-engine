import * as THREE from 'three/webgpu';
import { assembleRooms, geometryOf, outlinesOf, plain, reflectanceOf } from './InteriorRooms.js';
import { Haze } from '../light/Haze.js';

/** A building's floors are worth fetching this close to its footprint. */
const LOAD_RADIUS = 70;
/** And the building is let go past this, with hysteresis so a boundary cannot thrash. */
const DROP_RADIUS = 95;
/** One floor at a time: the worker is one thread and the frame gets one landing. */
const CONCURRENCY = 1;
/** The published key whose geometry the lifts take their sliding leaves from. */
const ELEVATOR_DOOR = '/elevator_door/';
/** Floors above and below the one the player is on that are fetched and in the scene. */
const BAND_REACH = 1;
/** One floor further stays in memory, so a landing halfway up the stairs never refetches. */
const KEEP_REACH = BAND_REACH + 1;
/** Main-thread work the stream may take in one frame before the rest waits for the next. */
const FRAME_BUDGET_MS = 8;

const EMPTY = 'empty';
const LOADING = 'loading';
const LOADED = 'loaded';
const FAILED = 'failed';

/**
 * Interiors, streamed a floor at a time. A furnished tower is tens of
 * megabytes and sixty floors of geometry, and the player is only ever on one
 * of them, so neither the file nor the building belongs in memory:
 *
 * - a building within reach is opened: its shafts are registered from its
 *   floor documents and every floor gets a band, empty until it is wanted;
 * - only the floors within one of the player's own are fetched, nearest
 *   building first, and each floor's own GLB is parsed, baked to world space
 *   and cut into the rooms the interior box published in a worker
 *   (InteriorWorker.js); the frame only wraps the arrays it posts back;
 * - those same floors are in the scene and in the physics world, one more
 *   above and below stays in memory, and a floor further away than that is
 *   dropped, vertex data and all. Walking up the stairs moves the window;
 * - past a wider radius the whole building is let go.
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

	/**
	 * @param buildings Map<parcelId, { floors }>, each floor document carrying
	 * the `glbUrl` of its own geometry (WorldSource)
	 * @param centers Map<parcelId, { x, z }> footprint centres
	 */
	register( buildings, centers ) {

		for ( const [ parcelId, building ] of buildings ) {

			this.pending.set( parcelId, { parcelId, floors: building.floors, center: centers.get( parcelId ) } );

		}

	}

	/** Buildings open around the player, whatever their floors hold. */
	get liveInteriors() {

		return this.live.size;

	}

	/**
	 * One pass over what should be open, what should be in memory and what
	 * should be in the scene. Cheap to call every frame: a hypot per building
	 * and a subtraction per floor. Collider work shares one frame budget, and
	 * whatever it leaves unfinished the next pass picks up.
	 *
	 * @returns whether the set of rooms in memory or in the scene changed
	 */
	update( feet ) {

		this.changed = false;

		for ( const entry of this.pending.values() ) {

			if ( ! this.live.has( entry.parcelId ) && ground( entry.center, feet ) < LOAD_RADIUS ) this.#open( entry );

		}

		const budget = new FrameBudget( FRAME_BUDGET_MS );
		let next = null;

		for ( const [ parcelId, interior ] of this.live ) {

			const distance = ground( interior.center, feet );

			if ( distance > DROP_RADIUS ) {

				this.#drop( parcelId );
				continue;

			}

			const want = this.#band( interior, feet, budget );

			// Nearest building first: the one being walked into is the one whose
			// floor has to be there, and the far side of the block can wait.
			if ( want && ( ! next || distance < next.distance ) ) next = { interior, band: want, distance };

		}

		if ( next && this.loading < CONCURRENCY ) this.#load( next.interior, next.band );

		return this.changed;

	}

	/** Lets every interior go and stops the worker. */
	dispose() {

		for ( const parcelId of [ ...this.live.keys() ] ) this.#drop( parcelId );

		this.worker.dispose();

	}

	/** A building within reach: shafts from its floor documents, a band per floor. */
	#open( entry ) {

		const interior = new Interior( entry );

		this.elevators?.add( interior.parcelId, interior.floors, interior.group );
		this.group.add( interior.group );
		this.live.set( interior.parcelId, interior );

	}

	#drop( parcelId ) {

		const interior = this.live.get( parcelId );

		this.live.delete( parcelId );

		for ( const band of interior.bands ) this.#unload( interior, band );

		this.elevators?.remove( parcelId );
		this.group.remove( interior.group );

	}

	/**
	 * Which floors of one building are in memory and in the scene. The player's
	 * own floor is whichever band holds their feet, so standing on the street
	 * puts the ground floor and its neighbours in and leaves the tower above out.
	 *
	 * @returns the empty band nearest the player's floor that wants fetching, if any
	 */
	#band( interior, feet, budget ) {

		const standing = floorAt( interior.bands, feet.y );
		let want = null;

		for ( const band of interior.bands ) {

			const away = Math.abs( band.floor - standing );

			if ( away > KEEP_REACH ) {

				if ( band.state !== EMPTY && band.state !== FAILED ) this.#unload( interior, band );

			} else if ( away > BAND_REACH ) {

				if ( band.live ) this.#hide( band );

			} else if ( band.state === EMPTY ) {

				if ( ! want || away < Math.abs( want.floor - standing ) ) want = band;

			} else if ( band.state === LOADED && ! band.live && ! budget.spent ) {

				this.#show( band );

			}

		}

		return want;

	}

	/** A loaded band goes into the scene and into the physics world. */
	#show( band ) {

		band.live = true;
		band.group.visible = true;
		this.changed = true;

		const t = performance.now();
		this.onColliderBand?.( band.id, band.collider() );
		this.hitches?.note( `band ${band.id} collider`, performance.now() - t );

	}

	#hide( band ) {

		band.live = false;
		band.group.visible = false;
		this.onDropBand?.( band.id );
		this.changed = true;

	}

	/** Lets a floor go: out of the scene, out of the shafts, out of memory. */
	#unload( interior, band ) {

		if ( band.live ) this.#hide( band );

		const gone = new Set( band.rooms );

		if ( gone.size ) {

			this.rooms = this.rooms.filter( ( room ) => ! gone.has( room ) );
			this.changed = true;

		}

		this.elevators?.release( interior.parcelId, band.floor );
		band.clear();

	}

	async #load( interior, band ) {

		this.loading ++;
		band.state = LOADING;

		try {

			const built = await this.#build( interior, band );

			// A drop can have overtaken the load on a fast walk past a building.
			if ( ! built ) return;

			band.take( built );
			this.rooms.push( ...built.rooms );
			this.changed = true;

		} catch ( error ) {

			// A load nobody waits for any more fails quietly.
			if ( ! this.#wanted( interior, band ) ) return;

			band.state = FAILED;
			console.warn( `floor ${band.id}: ${error?.message ?? error}` );

		} finally {

			this.loading --;

		}

	}

	/** Whether the floor is still wanted since its load began. */
	#wanted( interior, band ) {

		return band.state === LOADING && this.live.get( interior.parcelId ) === interior;

	}

	/**
	 * Lands one floor: the worker cuts it, the frame assembles rooms and the
	 * band's own surfaces from what it posted, each step spread over as many
	 * frames as its budget takes and noted with its thread time. Everything is
	 * built aside and handed over whole, so a load that stops being wanted
	 * leaves nothing behind.
	 *
	 * @returns { content, rooms, solid }, or null when it stopped being wanted
	 */
	async #build( interior, band ) {

		const { parcelId } = interior;
		const sent = performance.now();
		const { cut, bytes, cost } = await this.worker.cut( band.glbUrl, interior.outlines );
		this.hitches?.note( `floor ${band.id} off thread ${( bytes / 1048576 ).toFixed( 1 )} MB: `
			+ `${Object.entries( cost ).map( ( [ step, ms ] ) => `${step} ${ms} ms` ).join( ', ' )}, `
			+ `round trip ${( performance.now() - sent ).toFixed( 0 )} ms` );

		if ( ! this.#wanted( interior, band ) ) return null;

		const reflectance = await this.#reflectance( keysOf( cut ) );

		if ( ! this.#wanted( interior, band ) ) return null;

		let budget = new FrameBudget( FRAME_BUDGET_MS );
		const rooms = [];

		for ( const room of assembleRooms( parcelId, cut, interior.floors, reflectance ) ) {

			// A room is shown by distance and lit by the slot pool on separate
			// timers, so it enters the scene already dressed in the dim binding.
			room.wear( this.roomLights.dim, this.roomLights );
			rooms.push( room );

			if ( ! await this.#rest( budget, interior, band ) ) return null;

		}

		this.hitches?.note( `floor ${band.id} rooms ${budget.frames} frames`, budget.busy );

		budget = new FrameBudget( FRAME_BUDGET_MS );
		const content = new THREE.Group();
		const solid = [];

		for ( const { surfaces } of cut.shared ) {

			for ( const surface of surfaces ) {

				const material = this.roomLights.materialFor( this.roomLights.dim, surface.key );
				let geometry = geometryOf( surface );

				// The lift doors are published as geometry like everything else;
				// the shafts take theirs so they can slide.
				if ( surface.key.includes( ELEVATOR_DOOR ) ) {

					geometry = this.elevators?.claim( parcelId, band.floor, geometry, material, content ) ?? geometry;

				}

				if ( ! geometry ) continue;

				content.add( new THREE.Mesh( geometry, material ) );
				solid.push( geometry.getAttribute( 'position' ).array );

			}

			if ( ! await this.#rest( budget, interior, band ) ) {

				this.elevators?.release( parcelId, band.floor );
				return null;

			}

		}

		for ( const room of rooms ) {

			room.group.visible = false;
			content.add( room.group );

			for ( const { mesh } of room.meshes ) solid.push( mesh.geometry.getAttribute( 'position' ).array );

		}

		// The air inside the floor's rooms, parented to the band so it is
		// culled and dropped with the floor it belongs to.
		const glow = this.haze && Haze.build( rooms.flatMap( ( room ) => room.fixtures ), this.haze );

		if ( glow ) content.add( glow );

		this.hitches?.note( `floor ${band.id} band ${budget.frames} frames`, budget.busy );

		return { content, rooms, solid };

	}

	/**
	 * Lets the frame go once the budget is spent.
	 * @returns whether the floor is still wanted afterwards
	 */
	async #rest( budget, interior, band ) {

		await budget.rest();

		return this.#wanted( interior, band );

	}

	/** Reflectance per key: level from what the surface is, hue from its map. */
	async #reflectance( keys ) {

		const tints = new Map( await Promise.all(
			[ ...keys ].map( async ( key ) => [ key, await this.factory.tint( plain( key ) ) ] )
		) );

		return ( key ) => reflectanceOf( plain( key ), tints.get( key ) );

	}

}

/** One building open around the player: its floors as bands, lowest first. */
class Interior {

	constructor( { parcelId, floors, center } ) {

		this.parcelId = parcelId;
		this.center = center;
		this.floors = floors;
		this.outlines = outlinesOf( floors );
		this.group = new THREE.Group();
		this.group.name = `interior:${parcelId}`;
		this.bands = [ ...floors ]
			.sort( ( a, b ) => a.floor - b.floor )
			.map( ( floor ) => new FloorBand( parcelId, floor ) );

		for ( const band of this.bands ) this.group.add( band.group );

	}

}

/**
 * One floor of one interior: fetched while the player is within a floor of it,
 * in the scene and solid while it stays so. Its collider is built the first
 * time it goes live, from the same arrays its meshes draw, and everything is
 * let go together, so a tower's other floors never cost a byte.
 */
class FloorBand {

	constructor( parcelId, { floor, elevation, height, glbUrl } ) {

		this.id = `${parcelId}:${floor}`;
		this.floor = floor;
		this.elevation = elevation;
		this.height = height;
		this.glbUrl = glbUrl;
		this.group = new THREE.Group();
		this.group.name = `interior:${this.id}`;
		this.group.visible = false;
		this.state = EMPTY;
		this.live = false;
		this.content = null;
		this.rooms = [];
		this.solid = [];
		this.trimesh = null;

	}

	/** Takes what a landing built: the floor's meshes, its rooms, its solid arrays. */
	take( { content, rooms, solid } ) {

		this.content = content;
		this.rooms = rooms;
		this.solid = solid;
		this.group.add( content );
		this.state = LOADED;

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

	/** Back to empty: nothing of the floor's geometry is referenced afterwards. */
	clear() {

		this.trimesh?.dispose();
		this.content?.traverse( ( node ) => node.geometry?.dispose() );

		if ( this.content ) this.group.remove( this.content );

		this.trimesh = null;
		this.content = null;
		this.rooms = [];
		this.solid = [];
		this.state = EMPTY;

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

	/**
	 * @param url one floor's GLB
	 * @param outlines the building's floors as `outlinesOf` keeps them
	 * @returns { cut, bytes, cost } as InteriorWorker.js posts them
	 */
	cut( url, outlines ) {

		const id = this.serial ++;

		return new Promise( ( resolve, reject ) => {

			this.waiting.set( id, { resolve, reject } );
			this.#worker().postMessage( { id, url, outlines } );

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
 * How much of a frame the stream may take. A loop checks in after each piece
 * of work; once the slice has run past the budget, the next piece waits for
 * the next frame. Keeps the thread time it took, over how many frames.
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
