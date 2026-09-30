import * as THREE from 'three/webgpu';
import { buildApartmentDoors } from './ApartmentDoors.js';
import { buildingFloors, floorPlacements } from './InteriorLayouts.js';
import { furnitureBoxes } from './FurnitureBoxes.js';
import { floorBoxes } from './InteriorBoxes.js';
import { moduleError } from './InteriorModules.js';
import { floorFill, floorOrphans, roomsOf } from './InteriorRooms.js';
import { Haze } from '../light/Haze.js';

/** A building's floors are worth building this close to its footprint. */
const LOAD_RADIUS = 70;
/** And the building is let go past this, with hysteresis so a boundary cannot thrash. */
const DROP_RADIUS = 95;
/** Builds may await assets while another floor is admitted. */
const BUILD_CONCURRENCY = 2;
const ADMISSION_CONCURRENCY = 2;
/** Floors above and below the one the player is on that are in the scene. */
const BAND_REACH = 1;
/** One floor further stays built, so a landing halfway up the stairs never rebuilds. */
const KEEP_REACH = BAND_REACH + 1;
/**
 * A building the player stands this close to (on the ground, to its
 * footprint) is the one they are in: its floors are all drawn and cast.
 */
const INSIDE = 1;
/**
 * Another building's floors are drawn only this close, where its rooms are
 * seen through the glass and the game lights them (its room view reaches
 * 32 m), and let go past the second distance so a walk along the boundary
 * cannot thrash. Further out they stay built and solid, out of the draws:
 * the loading radius is for walking in, not for looking.
 */
const VIEW_RADIUS = 32;
const VIEW_KEEP = 36;
/** The module the lifts move themselves, one car per shaft. */
const LIFT_CAR = 'lift-car';
/** And the landing leaves they slide open. */
const LIFT_DOORS = 'lift-doors';

const EMPTY = 'empty';
const LOADING = 'loading';
const LOADED = 'loaded';
const FAILED = 'failed';

/**
 * Interiors, streamed a floor at a time.
 *
 * A furnished building is three placement tables: a ground layout, one middle
 * layout every middle floor shares, and a crown. A floor is a list of copies
 * of the city's shared room modules plus catalog furniture, so nothing about
 * it is fetched per floor and nothing about it is per-floor geometry:
 *
 * - a building within reach is opened: its shafts are registered from its
 *   floor records and every floor gets a band, empty until it is wanted;
 * - a floor within one of the player's own is built: its placements become
 *   instances of the shared module and furniture draws at that floor's
 *   elevation, each carrying the fill of the room it stands in, its rooms are
 *   published for the light pool, and its modules become one cuboid compound;
 * - those same floors are in the scene and in the physics world, one more
 *   above and below stays built, and a floor further away than that drops its
 *   instances. Walking up the stairs moves the window;
 * - those floors are drawn only in a building within sight of its rooms,
 *   and cast room shadows only in the building the player is in; further
 *   out they stay built and solid, so walking in never waits for them;
 * - past a wider radius the whole building is let go.
 *
 * The shells are not here: they load once for the whole city (BuildingsLoader,
 * kit runtime) because the skyline is visible from everywhere.
 */
export class InteriorStream {

	/**
	 * @param modules InteriorModules, the city's shared room module draws
	 * @param props InteriorProps, the city's shared furniture draws, or null
	 * @param roomLights RoomLights, which the published rooms are lit through
	 * @param haze { spread, cap } for the air inside a room, or null at tiers
	 * that do not draw it
	 * @param warmup a `Warmup` (src/game/look/Warmup.js), which builds a landed
	 * floor's own renderables before it is ever drawn
	 */
	constructor( { modules, props = null, roomLights, haze, elevators, hitches = null, warmup = null } ) {

		this.modules = modules;
		this.props = props;
		this.roomLights = roomLights;
		this.haze = haze;
		this.elevators = elevators;
		this.hitches = hitches;
		this.warmup = warmup;
		this.group = new THREE.Group();
		this.group.name = 'interiors';
		if ( modules ) this.group.add( modules.group );
		if ( props ) this.group.add( props.group );
		this.pending = new Map();
		this.live = new Map();
		this.building = 0;
		this.admitting = 0;
		/** Whether the interior draws cast room shadows: only while the player is in a building. */
		this.casting = true;
		this.recast = false;
		this.requests = new Map();
		if ( elevators ) elevators.stream = this;
		this.rooms = [];
		this.onColliderBand = null;
		this.onDropBand = null;
		this.changed = false;
		/** The `ApartmentDoors` registry the shown floors' apartment doors join, once the host has physics. */
		this.apartmentDoors = null;

	}

	/**
	 * @param buildings Map<parcelId, { interior: { building, layouts }, hasInterior }>
	 * @param centers Map<parcelId, { x, z }> footprint centres
	 */
	register( buildings, centers ) {

		for ( const [ parcelId, building ] of buildings ) {

			if ( building.hasInterior === false || ! building.interior ) continue;
			this.pending.set( parcelId, {
				parcelId,
				floors: buildingFloors( parcelId, building.interior ),
				center: centers.get( parcelId ),
				bounds: footprintBounds( building.blueprint?.bounds?.footprint ?? building.interior.layouts.ground?.floor.rooms.flatMap( room => room.polygon ) )
			} );

		}

	}

	get loading() { return this.building + this.admitting; }

	/** A lift keeps its destination and both neighbouring bands requested. */
	requestFloor( parcelId, floor ) {

		if ( ! this.pending.has( parcelId ) ) return false;
		this.requests.set( parcelId, floor );
		return true;

	}

	releaseFloor( parcelId ) { this.requests.delete( parcelId ); }

	/** Loading-screen preparation of the floors visible from the starting point. */
	async prepare( feet ) {

		for ( ;; ) {

			this.update( feet );
			if ( ! this.loading ) break;
			await new Promise( resolve => setTimeout( resolve, 0 ) );

		}

	}

	/** Buildings open around the player, whatever their floors hold. */
	get liveInteriors() {

		return this.live.size;

	}

	/** Whether one floor of a building is drawn and solid now. */
	floorShown( parcelId, floor ) {

		return this.live.get( parcelId )?.bands.some( ( band ) => band.floor === floor && band.live ) === true;

	}

	/**
	 * One pass over what should be open, what should be built and what should
	 * be in the scene. Cheap to call every frame: a hypot per building and a
	 * subtraction per floor.
	 *
	 * @returns whether the set of rooms in memory or in the scene changed
	 */
	update( feet ) {

		this.changed = false;

		for ( const entry of this.pending.values() ) {

			if ( ! this.live.has( entry.parcelId ) && ground( entry, feet ) < LOAD_RADIUS ) this.#open( entry );

		}

		let next = null;
		let inside = false;

		for ( const [ parcelId, interior ] of this.live ) {

			const distance = ground( interior, feet );

			if ( distance > DROP_RADIUS ) {

				this.#drop( parcelId );
				continue;

			}

			interior.inside = distance <= INSIDE || this.requests.has( parcelId );
			interior.near = distance < ( interior.near ? VIEW_KEEP : VIEW_RADIUS );
			inside ||= interior.inside;
			this.elevators?.draw?.( parcelId, interior.inside || interior.near );

			const want = this.#band( interior, feet );

			// Nearest building first: the one being walked into is the one whose
			// floor has to be there, and the far side of the block can wait.
			if ( want && ( ! next || distance < next.distance ) ) next = { interior, band: want, distance };

		}

		if ( next && this.building < BUILD_CONCURRENCY ) this.#load( next.interior, next.band );

		this.#cast( inside );

		return this.changed;

	}

	/** Lets every interior go. */
	dispose() {

		for ( const parcelId of [ ...this.live.keys() ] ) this.#drop( parcelId );

	}

	/**
	 * The port the shafts stand their own cuboids through. A lift's landing
	 * leaves and its cab floor come and go with the doors rather than with a
	 * floor band, so they go through the same collider callbacks under ids of
	 * their own.
	 */
	get liftColliders() {

		return {
			solid: ( id, boxes ) => Promise.resolve( this.onColliderBand?.( id, { boxes, positions: [] } ) ).catch( () => {} ),
			drop: ( id ) => this.onDropBand?.( id )
		};

	}

	/**
	 * Room shadows are cast only while the player is in a building: the one
	 * caster lights the room they stand in, and from the street it would
	 * otherwise draw every copy of the shared furniture, most of them in
	 * other buildings, into a map of somebody else's room. A draw that grew
	 * since comes back as a new mesh, so the flag is written again after
	 * anything was admitted.
	 */
	#cast( casting ) {

		if ( casting === this.casting && ! ( this.recast && ! casting ) ) {

			this.recast = false;
			return;

		}
		this.casting = casting;
		this.recast = false;
		this.group.traverse( ( node ) => {

			if ( ! node.isMesh ) return;
			node.userData.roomCaster ??= node.castShadow;
			node.castShadow = casting && node.userData.roomCaster;

		} );

	}

	/** A building within reach: shafts from its floor records, a band per floor. */
	#open( entry ) {

		const interior = new Interior( entry );

		this.elevators?.bind?.( this.liftColliders );
		this.elevators?.add( interior.parcelId, interior.floors, interior.group );
		this.group.add( interior.group );
		this.live.set( interior.parcelId, interior );

	}

	#drop( parcelId ) {

		const interior = this.live.get( parcelId );

		this.live.delete( parcelId );

		for ( const band of interior.bands ) this.#unload( interior, band );

		this.apartmentDoors?.forget( parcelId );
		this.elevators?.remove( parcelId );
		this.group.remove( interior.group );

	}

	/**
	 * Which floors of one building are built and in the scene. The player's own
	 * floor is whichever band holds their feet, so standing on the street puts
	 * the ground floor and its neighbours in and leaves the tower above out.
	 *
	 * @returns the empty band nearest the player's floor that wants building, if any
	 */
	#band( interior, feet ) {

		const standing = floorAt( interior.bands, feet.y );
		let want = null;

		for ( const band of interior.bands ) {

			if ( band.draw( interior.inside || interior.near ) ) this.recast = true;

			const requested = this.requests.get( interior.parcelId );
			const away = Math.min( Math.abs( band.floor - standing ), requested === undefined ? Infinity : Math.abs( band.floor - requested ) );
			if ( away <= BAND_REACH && ! band.live ) this.#placeholder( band );

			if ( away > KEEP_REACH ) {

				if ( band.state !== EMPTY && band.state !== FAILED ) this.#unload( interior, band );

			} else if ( away > BAND_REACH ) {

				if ( band.live || band.admission ) this.#hide( band );

			} else if ( band.state === EMPTY ) {

				if ( ! want || away < Math.abs( want.floor - standing ) ) want = band;

			} else if ( band.state === LOADED && ! band.live && ! band.admission && this.admitting < ADMISSION_CONCURRENCY ) {

				this.#show( interior, band );

			}

		}

		return want;

	}

	/** Real module slabs hold the floor while furniture and light programs load. */
	#placeholder( band ) {

		if ( band.placeholder || band.state === FAILED ) return;
		const token = { handles: [] };
		band.placeholder = token;
		const placements = floorPlacements( band.record ).filter( one => one.module?.startsWith( 'floor-' ) );
		const boxes = floorBoxes( placements, band.elevation, id => this.modules.boundsOf( id ) );
		this.admitting ++;
		Promise.resolve( this.onColliderBand?.( `${band.id}/floor`, { boxes, positions: [] } ) ).then( ready => {

			if ( band.placeholder !== token || ready === false ) return;
			this.modules.reserve?.( placements.map( one => one.module ) );
			for ( const placement of placements ) token.handles.push( this.modules.admit( placement.module,
				matrixOf( placement, band.elevation ), new THREE.Vector4( 0, 0, 0, 0 ), placement.uvRepeat ) );
			this.recast = true;

		} ).catch( error => { console.warn( `floor ${band.id} support: ${error.message}` ); this.#dropPlaceholder( band ); } )
			.finally( () => { this.admitting --; } );

	}

	#dropPlaceholder( band ) {

		if ( ! band.placeholder ) return;
		for ( const handle of band.placeholder.handles ) this.modules.release( handle );
		band.placeholder = null;
		this.onDropBand?.( `${band.id}/floor` );

	}

	/** A floor stays out of the draws and out of the scene until it is solid. */
	async #show( interior, band ) {

		const admission = {};
		band.admission = admission;
		this.admitting ++;
		const t = performance.now();
		try {

			const ready = await this.onColliderBand?.( band.id, band.solid );
			if ( band.admission !== admission || band.state !== LOADED || ready === false ) return;
			this.#dropPlaceholder( band );
			band.live = true;
			band.group.parent.visible = true;
			band.show();
			this.apartmentDoors?.show( band.id, band.apartmentDoors );
			this.changed = true;
			this.recast = true;

		} catch ( error ) {

			if ( band.admission !== admission ) return;
			this.#unload( interior, band );
			band.state = FAILED;
			console.warn( `floor ${band.id} collider: ${error?.message ?? error}` );

		} finally {

			if ( band.admission === admission ) band.admission = null;
			this.admitting --;
			this.hitches?.note( `band ${band.id} collider admission elapsed`, performance.now() - t );

		}

	}

	#hide( band ) {

		this.apartmentDoors?.hide( band.id );
		band.admission = null;
		band.live = false;
		band.hide();
		this.onDropBand?.( band.id );
		this.changed = true;

	}

	/** Lets a floor go: out of the draws, out of the shafts, out of memory. */
	#unload( interior, band ) {

		if ( band.live || band.admission ) this.#hide( band );

		const gone = new Set( band.rooms );

		if ( gone.size ) {

			this.rooms = this.rooms.filter( ( room ) => ! gone.has( room ) );
			this.changed = true;

		}

		this.roomLights?.releaseRooms?.( band.rooms );
		this.#dropPlaceholder( band );
		this.elevators?.release( interior.parcelId, band.floor );
		band.clear();

	}

	async #load( interior, band ) {

		this.building ++;
		band.state = LOADING;

		try {

			const built = await this.#build( interior, band );

			// A drop can have overtaken the build on a fast walk past a building.
			if ( ! built ) return;

			band.take( built );
			this.rooms.push( ...built.rooms );
			this.changed = true;

		} catch ( error ) {

			// A build nobody waits for any more fails quietly.
			if ( ! this.#wanted( interior, band ) ) return;

			band.state = FAILED;
			console.warn( `floor ${band.id}: ${error?.message ?? error}` );

		} finally {

			this.building --;

		}

	}

	/** Whether the floor is still wanted since its build began. */
	#wanted( interior, band ) {

		return band.state === LOADING && this.live.get( interior.parcelId ) === interior;

	}

	/**
	 * Builds one floor: every placement becomes an instance of a shared draw at
	 * this floor's elevation, the modules become one cuboid compound, the lift
	 * takes its own landing leaves, and the rooms are published. Everything is
	 * built aside and handed over whole, so a build that stops being wanted
	 * leaves nothing behind.
	 *
	 * @returns what the band takes, or null when it stopped being wanted
	 */
	async #build( interior, band ) {

		const { record } = band;
		const started = performance.now();

		await this.props?.prepare( floorPlacements( record ).filter( ( one ) => one.prop ).map( ( one ) => one.prop ) );

		if ( ! this.#wanted( interior, band ) ) return null;

		const rooms = roomsOf( record, this.modules );
		const orphans = floorOrphans( record );
		const fills = new Map( rooms.map( ( room ) => [ room.roomId, room.fill ] ) );
		const shared = floorFill( rooms, orphans.fixtures );

		if ( orphans.rooms.length ) {

			this.hitches?.note( `floor ${band.id} lights ${orphans.rooms.join( ', ' )}, which it does not publish as rooms`, 0 );

		}
		const copies = [];
		const content = new THREE.Group();
		content.name = `interior:${band.id}`;
		// A door that cannot stand leaves its doorway open; it never fails the floor around it.
		const apartmentGroup = buildApartmentDoors( record, this.modules, {
			fills, shared,
			refused: ( entrance, error ) => console.warn( `floor ${band.id} leaves entrance ${entrance?.id} open: ${error?.message ?? error}` )
		} );
		content.add( apartmentGroup );

		for ( const placement of floorPlacements( record ) ) {

			// The lifts move their own copies, so those never enter the shared draws.
			if ( placement.module === LIFT_CAR || placement.module === LIFT_DOORS ) {

				this.elevators?.mount( interior.parcelId, record.floor, placement, this.modules, content );
				continue;

			}
			if ( placement.module && ! this.modules.has( placement.module ) ) {

				throw moduleError( `${band.id} places ${placement.module}` );

			}
			// A world published without a furniture catalog stands unfurnished,
			// and one without this piece's model stands without that piece.
			if ( placement.prop && ! this.props?.has( placement.prop ) ) continue;
			copies.push( {
				draws: placement.module ? this.modules : this.props,
				id: placement.module ?? placement.prop,
				matrix: matrixOf( placement, record.elevation ),
				uvRepeat: placement.uvRepeat ?? [ 1, 1 ],
				fill: fills.get( placement.room ) ?? shared
			} );

		}

		const glow = this.haze && Haze.build( [ ...rooms.flatMap( ( room ) => room.fixtures ), ...orphans.fixtures ], this.haze );

		if ( glow ) content.add( glow );

		this.hitches?.note( `floor ${band.id} ${copies.length} copies`, performance.now() - started );

		// The floor's own renderables are the lift leaves and its haze; the
		// module and furniture draws were compiled once for the whole city.
		// The cars ride outside any floor's content and wear the lifts' shared
		// materials, which the load prepares, so for them this finds nothing
		// left to do unless the load had no lift to prepare.
		if ( this.warmup ) {

			const wanted = () => this.#wanted( interior, band );
			await this.warmup.warmAll( content, { wanted } );
			for ( const car of this.elevators?.cars?.( interior.parcelId ) ?? [] ) if ( wanted() ) await this.warmup.warmAll( car, { wanted } );

		}

		if ( ! this.#wanted( interior, band ) ) {

			disposeContent( content );
			return null;

		}

		return {
			content, rooms, copies, apartmentDoors: apartmentGroup.userData.apartmentDoors,
			solid: {
				boxes: [ ...floorBoxes( floorPlacements( record ), record.elevation, ( id ) => this.modules.boundsOf( id ) ),
					...furnitureBoxes( floorPlacements( record ), record.elevation, this.props ) ],
				positions: []
			}
		};

	}

}

/** One building open around the player: its floors as bands, lowest first. */
class Interior {

	constructor( { parcelId, floors, center, bounds } ) {

		this.parcelId = parcelId;
		this.center = center;
		this.bounds = bounds;
		this.floors = floors;
		this.group = new THREE.Group();
		this.group.name = `interior:${parcelId}`;
		this.group.visible = false;
		this.bands = floors.map( ( record ) => new FloorBand( record ) );
		/** Whether the player is in this building, and whether it is close enough for its rooms to be seen. */
		this.inside = false;
		this.near = false;

		for ( const band of this.bands ) this.group.add( band.group );

	}

}

/**
 * One floor of one interior: built while the player is within a floor of it,
 * drawn and solid while it stays so. Its copies only reach the shared instance
 * buffers while it is shown, so a floor hidden behind the one above draws
 * nothing and a tower's other floors cost neither a draw nor a matrix.
 */
class FloorBand {

	constructor( record ) {

		this.record = record;
		this.id = record.id;
		this.floor = record.floor;
		this.elevation = record.elevation;
		this.height = record.height;
		this.group = new THREE.Group();
		this.group.name = `interior:${this.id}`;
		this.group.visible = false;
		this.state = EMPTY;
		this.live = false;
		this.content = null;
		this.copies = [];
		this.handles = null;
		this.rooms = [];
		this.solid = { boxes: [], positions: [] };
		/** Its apartment doors, which the stream's registry makes openable while it is shown. */
		this.apartmentDoors = [];
		this.admission = null;
		/** Whether a shown floor is drawn, or stands solid and unseen. */
		this.shown = false;
		this.drawn = true;

	}

	/** Takes what a build made: the floor's own meshes, its rooms, its copies, its apartment doors. */
	take( { content, rooms, copies, solid, apartmentDoors = [] } ) {

		this.content = content;
		this.rooms = rooms;
		this.copies = copies;
		this.solid = solid;
		this.apartmentDoors = apartmentDoors;
		this.group.add( content );
		this.state = LOADED;

	}

	show() {

		this.shown = true;
		this.#paint();

	}

	hide() {

		this.shown = false;
		this.#paint();

	}

	/**
	 * Whether this floor is seen from where the player is. A floor that is not
	 * keeps its collider and its table, and only its copies leave the draws.
	 *
	 * @returns whether that put copies into the draws
	 */
	draw( drawn ) {

		if ( drawn === this.drawn ) return false;
		this.drawn = drawn;

		return this.#paint();

	}

	/** Copies in the shared draws exactly while the floor is shown and seen. */
	#paint() {

		const wanted = this.shown && this.drawn;
		this.group.visible = wanted;

		if ( wanted && ! this.handles ) {

			reserve( this.copies );
			this.handles = this.copies.map( ( { draws, id, matrix, fill, uvRepeat } ) => ( { draws, handle: draws.admit( id, matrix, fill, uvRepeat ) } ) );
			return true;

		}
		if ( ! wanted && this.handles ) {

			for ( const { draws, handle } of this.handles ) draws.release( handle );
			this.handles = null;

		}

		return false;

	}

	/** Back to empty: nothing of the floor is referenced afterwards. */
	clear() {

		this.hide();

		if ( this.content ) {

			this.group.remove( this.content );
			disposeContent( this.content );

		}
		this.admission = null;
		this.content = null;
		this.copies = [];
		this.rooms = [];
		this.solid = { boxes: [], positions: [] };
		this.apartmentDoors = [];
		this.state = EMPTY;

	}

}

function disposeContent( content ) {

	content.traverse( ( node ) => {

		node.geometry?.dispose();
		// The apartment doors' fill channels are the floor's own, one per door.
		for ( const channel of node.userData.apartmentFillChannels ?? [] ) channel.dispose();

	} );

}

/**
 * Room for this floor's copies in one reallocation per batch, before the first
 * of them is appended: the module batches are the city's, and a batch that
 * grows is a batch the renderer builds a pipeline for again. The furniture
 * draws keep their own growth.
 */
function reserve( copies ) {

	const wanted = new Map();

	for ( const { draws, id } of copies ) {

		if ( ! wanted.has( draws ) ) wanted.set( draws, [] );
		wanted.get( draws ).push( id );

	}
	for ( const [ draws, ids ] of wanted ) draws.reserve?.( ids );

}

/** One placement's world matrix: scale, then yaw, then position on its floor. */
function matrixOf( { position, rotationY, scale }, elevation ) {

	return new THREE.Matrix4()
		.makeTranslation( position[ 0 ], position[ 1 ] + elevation, position[ 2 ] )
		.multiply( _rotation.makeRotationY( rotationY ) )
		.multiply( _scale.makeScale( scale[ 0 ], scale[ 1 ], scale[ 2 ] ) );

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

function footprintBounds( outline ) {

	if ( ! outline?.length ) return null;
	const xs = outline.map( p => p[ 0 ] ), zs = outline.map( p => p[ 1 ] );
	return { x0: Math.min( ...xs ), x1: Math.max( ...xs ), z0: Math.min( ...zs ), z1: Math.max( ...zs ) };

}

function ground( { center, bounds }, point ) {

	if ( ! bounds ) return Math.hypot( center.x - point.x, center.z - point.z );
	return Math.hypot( Math.max( bounds.x0 - point.x, 0, point.x - bounds.x1 ), Math.max( bounds.z0 - point.z, 0, point.z - bounds.z1 ) );

}

const _rotation = new THREE.Matrix4();
const _scale = new THREE.Matrix4();
