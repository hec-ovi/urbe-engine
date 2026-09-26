import { buildingFloors } from '../city/InteriorLayouts.js';
import { area, intersectionArea } from '../props/Footprints.js';
import { hash32, rotate2, round } from './StagingAssembler.js';
import { SceneryError } from './SceneryError.js';

/** Bodies keep this far off a room's outline, which Interior draws on the wall line. */
const WALL_MARGIN = 0.15;
/** The smallest frame side the staging contract measures. */
const MIN_SIDE = 3;
const DOOR_CLEARANCE = { min: 0.6, max: 5 };
/** A street scene's default frame: along the lot line, and from it toward the curb. */
const STREET = { width: 6, depth: 3 };
/** A street fixture is in the way when it stands within this height over the pavement. */
const BODY_HEIGHT = 2.2;
const EPSILON = 1e-6;

/**
 * Turns a scene's place into the measured frame its elements are placed in,
 * from what the world publishes and nothing else: a furnished floor's rooms,
 * doors, furniture and holes (Interior's layouts, drawn at the building
 * floor's elevation), the story slots Interior reserves in its rooms, a
 * parcel's main entrance, and the sidewalk in front of a parcel's access
 * point (Atlas lot lines and ground covers, and the fixtures standing there).
 *
 * A room frame is the largest rectangle inside the room's outline in the
 * room's own orientation, kept off the walls; its doors are entries, and its
 * furniture and holes are blocked zones and blocked floor. Seeds only choose
 * among the rooms a place allows.
 */
export class ScenePlaceResolver {

	/**
	 * @param buildings Map<parcelId, { interior: { building, layouts } | null, npc }>, as the building source reads them
	 * @param doors the main entrances, `{ id, parcelId, inside: { x, y, z } }`
	 * @param atlas the Atlas blueprint: parcel lots and access points, ground
	 * covers, subway entrance bays and highway supports
	 * @param obstacles the solid fixtures the game stands on the street,
	 * `[{ footprint: [[x, z]], bottom, top }]` as street dressing reserves them
	 * (lamp posts, street features, props and trees)
	 */
	constructor( { buildings = new Map(), doors = [], atlas = null, obstacles = [] } = {} ) {

		this.buildings = buildings;
		this.doors = doors;
		this.atlas = atlas;
		this.obstacles = obstacles;
		this.street = null;

	}

	/**
	 * @param pinned a saved resolution `{ parcelId, floor, roomId }` to stand again exactly
	 * @returns `{ location, place, anchor }`: the frame in the investigation
	 * location shape, the resolved place, and for a story slot its point in the frame
	 */
	resolve( place, seed, pinned = null ) {

		switch ( place.kind ) {

			case 'room':
			case 'story-slot': return this.#room( place, seed, pinned );
			case 'parcel-entry': return this.#entry( place, pinned );
			default: return this.#street( place );

		}

	}

	#room( place, seed, pinned ) {

		const floor = this.#floor( place.parcelId, place.floor );
		const slots = place.kind === 'story-slot' ? storySlots( floor.npc, place.floor ) : null;
		const rooms = slots ? floor.record.rooms.filter( ( room ) => slots.has( room.id ) ) : floor.record.rooms;
		const roomId = pinned?.roomId ?? place.roomId;
		let room = null;
		let location = null;

		if ( roomId ) {

			room = rooms.find( ( candidate ) => candidate.id === roomId );
			if ( ! room ) throw placeError( `${floor.label} has no ${slots ? 'story slot in room' : 'room'} ${roomId}` );
			location = this.#frame( floor, room );
			if ( ! location ) throw noFit( `room ${roomId} of ${floor.label} is smaller than ${MIN_SIDE} by ${MIN_SIDE} m` );

		} else {

			const candidates = rooms.filter( ( candidate ) => place.roomKinds.includes( candidate.kind ) )
				.sort( ( left, right ) => left.id.localeCompare( right.id ) );
			if ( ! candidates.length ) throw placeError( `${floor.label} has no ${place.roomKinds.join( ' or ' )} room${slots ? ' with a story slot' : ''}` );
			const start = hash32( `${seed}:room` ) % candidates.length;
			for ( let offset = 0; offset < candidates.length && ! location; offset ++ ) {

				room = candidates[ ( start + offset ) % candidates.length ];
				location = this.#frame( floor, room );

			}
			if ( ! location ) throw noFit( `no ${place.roomKinds.join( ' or ' )} room of ${floor.label} is ${MIN_SIDE} by ${MIN_SIDE} m` );

		}

		const slot = slots?.get( room.id );
		return {
			location,
			place: { parcelId: place.parcelId, floor: place.floor, roomId: room.id },
			anchor: slot ? frameLocal( location, { x: slot.position[ 0 ], z: slot.position[ 1 ] } ) : null
		};

	}

	/** The ground-floor room the parcel's main entrance opens into. */
	#entry( place, pinned ) {

		const floor = this.#floor( place.parcelId, 0 );
		let room;
		if ( pinned?.roomId ) {

			room = floor.record.rooms.find( ( candidate ) => candidate.id === pinned.roomId );
			if ( ! room ) throw placeError( `${floor.label} has no room ${pinned.roomId}` );

		} else {

			const door = this.#mainDoor( place.parcelId );
			if ( ! door ) throw placeError( `${place.parcelId} has no main entrance` );
			room = roomAt( floor.record.rooms, { x: door.inside.x, z: door.inside.z } );

		}
		const location = this.#frame( floor, room );
		if ( ! location ) throw noFit( `entrance room ${room.id} of ${floor.label} is smaller than ${MIN_SIDE} by ${MIN_SIDE} m` );
		return { location, place: { parcelId: place.parcelId, floor: 0, roomId: room.id }, anchor: null };

	}

	/**
	 * The sidewalk in front of the parcel's access point: the frame's back
	 * edge on the lot side the point stands on, local +z out toward the curb.
	 * It lies whole on sidewalk ground of one height, which is its floor; the
	 * fixtures standing on it are blocked zones, and the main door's apron on
	 * the lot line is an entry.
	 */
	#street( place ) {

		const parcel = this.atlas?.parcels?.find( ( candidate ) => candidate.id === place.parcelId );
		if ( ! parcel ) throw placeError( `the city has no parcel ${place.parcelId}` );
		const [ x, z ] = parcel.access.point;
		const outward = frontageNormal( parcel.lot, { x, z } );
		const yaw = zeroed( round( Math.atan2( outward.x, outward.z ) ) );
		const width = place.width ?? STREET.width;
		const depth = place.depth ?? STREET.depth;
		const frame = { origin: { x: round( x + outward.x * depth / 2 ), z: round( z + outward.z * depth / 2 ) }, yawRadians: yaw, width, depth };
		const ring = frameRing( frame );
		const floorY = this.#pavement( ring );
		if ( floorY === null ) throw noFit( `the sidewalk in front of ${place.parcelId} has no level ${width} by ${depth} m of pavement` );

		const origin = { x: frame.origin.x, y: floorY, z: frame.origin.z };
		const location = { kind: 'street', placeId: place.parcelId, origin, yawRadians: yaw, width, depth };
		const half = { x: width / 2, z: depth / 2 };
		const door = this.#mainDoor( place.parcelId );
		const doorway = door ? frameLocal( location, { x: door.inside.x, z: door.inside.z } ).x : 0;
		const blockers = this.#fixtures( ring, floorY )
			.map( ( footprint ) => bounds( footprint.map( ( [ px, pz ] ) => frameLocal( location, { x: px, z: pz } ) ) ) )
			.filter( ( zone ) => overlap( zone, { center: { x: 0, z: 0 }, width, depth } ) )
			.map( ( zone, index ) => ( { blockerId: `fixture:${index}`, ...zone } ) );
		location.entries = [
			{ entryId: 'doorway', position: { x: round( clamp( doorway, -half.x, half.x ) ), z: -half.z }, clearanceRadius: 1.1 },
			{ entryId: 'sidewalk-left', position: { x: -half.x, z: 0 }, clearanceRadius: DOOR_CLEARANCE.min },
			{ entryId: 'sidewalk-right', position: { x: half.x, z: 0 }, clearanceRadius: DOOR_CLEARANCE.min }
		];
		location.blockedZones = blockers;
		location.receivingSurfaces = [ floorSurface( origin, yaw, width, depth, blockers ) ];
		return { location, place: { parcelId: place.parcelId }, anchor: null };

	}

	/** The height of the sidewalk covering the whole ring at one height, or null. */
	#pavement( ring ) {

		const box = ringBox( ring );
		const target = area( ring );
		const covered = new Map();
		for ( const cover of this.#streetIndex().sidewalks ) {

			if ( ! boxesMeet( cover.box, box ) ) continue;
			covered.set( cover.top, ( covered.get( cover.top ) ?? 0 ) + intersectionArea( cover.polygon, ring ) );

		}
		for ( const [ top, value ] of covered ) if ( Math.abs( target - value ) <= target * 1e-6 + EPSILON ) return top;
		return null;

	}

	/** Footprints of the fixtures that stand in the ring at a body's height over the floor. */
	#fixtures( ring, floorY ) {

		const box = ringBox( ring );
		return this.#streetIndex().fixtures
			.filter( ( fixture ) => fixture.bottom < floorY + BODY_HEIGHT && fixture.top > floorY - EPSILON && boxesMeet( fixture.box, box ) )
			.map( ( fixture ) => fixture.footprint );

	}

	/** Sidewalk covers and street fixtures, each with its bounding box, read once. */
	#streetIndex() {

		if ( ! this.street ) {

			const boxed = ( item ) => ( { ...item, box: ringBox( item.footprint ?? item.polygon ) } );
			const atlas = this.atlas;
			this.street = {
				sidewalks: ( atlas.volumetric?.ground ?? [] ).filter( ( cover ) => cover.surface === 'sidewalk' ).map( boxed ),
				fixtures: [
					...this.obstacles,
					...( atlas.transit?.subwayStations ?? [] ).flatMap( ( station ) => ( station.entranceBays ?? [] )
						.map( ( bay ) => ( { footprint: bay.footprint, bottom: -Infinity, top: Infinity } ) ) ),
					...( atlas.streets?.highwayStructures ?? [] ).flatMap( ( structure ) => structure.supports )
				].map( boxed )
			};

		}
		return this.street;

	}

	/** The parcel's first main entrance by id, or null. */
	#mainDoor( parcelId ) {

		return this.doors.filter( ( candidate ) => candidate.parcelId === parcelId )
			.sort( ( left, right ) => String( left.id ).localeCompare( String( right.id ) ) )[ 0 ] ?? null;

	}

	#floor( parcelId, index ) {

		const building = this.buildings.get( parcelId );
		if ( ! building?.interior ) throw placeError( `${parcelId} has no furnished interior` );
		const record = buildingFloors( parcelId, building.interior ).find( ( candidate ) => candidate.floor === index );
		if ( ! record ) throw placeError( `${parcelId} has no floor ${index}` );
		const layout = building.interior.layouts[ record.layout ];
		return { record, furniture: layout.floor.furniture ?? [], npc: building.npc, label: `${parcelId} floor ${index}` };

	}

	#frame( floor, room ) {

		return roomFrame( floor.record.parcelId, room, floor.furniture.filter( ( item ) => item.room === room.id ), floor.record.elevation );

	}

}

/** Interior's story slots on one floor, by the floor's own room id. */
function storySlots( npc, floor ) {

	const prefix = `floor:${floor}/`;
	const slots = new Map();
	for ( const slot of npc?.placements ?? [] ) {

		if ( slot.purpose !== 'story' || slot.floor !== floor || ! slot.room.startsWith( prefix ) ) continue;
		const roomId = slot.room.slice( prefix.length );
		if ( ! slots.has( roomId ) ) slots.set( roomId, slot );

	}
	return slots;

}

/**
 * The frame of one room, or null when its largest inscribed rectangle is
 * smaller than the contract's minimum.
 */
function roomFrame( parcelId, room, furniture, floorY ) {

	const outline = room.polygon.map( ( [ x, z ] ) => ( { x, z } ) );
	const yaw = frameYaw( outline );
	const pivot = outline[ 0 ];
	const turned = ( point ) => rotate2( { x: point.x - pivot.x, z: point.z - pivot.z }, -yaw );
	const rect = largestRectangle( outline.map( turned ) );
	if ( ! rect ) return null;
	const minX = rect.minX + WALL_MARGIN;
	const maxX = rect.maxX - WALL_MARGIN;
	const minZ = rect.minZ + WALL_MARGIN;
	const maxZ = rect.maxZ - WALL_MARGIN;
	const width = round( maxX - minX );
	const depth = round( maxZ - minZ );
	if ( width < MIN_SIDE || depth < MIN_SIDE ) return null;

	const middle = rotate2( { x: ( minX + maxX ) / 2, z: ( minZ + maxZ ) / 2 }, yaw );
	const origin = { x: round( pivot.x + middle.x ), y: round( floorY ), z: round( pivot.z + middle.z ) };
	const location = { kind: 'interior', placeId: parcelId, origin, yawRadians: yaw, width, depth };
	const half = { x: width / 2, z: depth / 2 };

	const entries = [];
	for ( const door of room.doors ) {

		if ( entries.some( ( entry ) => entry.entryId === door.id ) ) continue;
		const at = frameLocal( location, { x: door.position[ 0 ], z: door.position[ 1 ] } );
		entries.push( {
			entryId: door.id,
			position: { x: round( clamp( at.x, -half.x, half.x ) ), z: round( clamp( at.z, -half.z, half.z ) ) },
			clearanceRadius: round( clamp( door.width / 2, DOOR_CLEARANCE.min, DOOR_CLEARANCE.max ) )
		} );

	}
	if ( ! entries.length ) throw placeError( `room ${room.id} of ${parcelId} has no door` );

	const blockers = [
		...furniture.map( ( item ) => {

			const turn = item.rotationDeg * Math.PI / 180 - yaw;
			const cosine = Math.abs( Math.cos( turn ) );
			const sine = Math.abs( Math.sin( turn ) );
			return {
				blockerId: item.id,
				center: frameLocal( location, { x: item.position[ 0 ], z: item.position[ 1 ] } ),
				width: round( cosine * item.size[ 0 ] + sine * item.size[ 1 ] ),
				depth: round( sine * item.size[ 0 ] + cosine * item.size[ 1 ] )
			};

		} ),
		...( room.holes ?? [] ).map( ( ring, index ) => ( {
			blockerId: `${room.id}:hole:${index}`,
			...bounds( ring.map( ( [ x, z ] ) => frameLocal( location, { x, z } ) ) )
		} ) )
	].filter( ( blocker ) => overlap( blocker, { center: { x: 0, z: 0 }, width, depth } ) );

	location.entries = entries;
	location.blockedZones = blockers;
	location.receivingSurfaces = [ floorSurface( origin, yaw, width, depth, blockers ) ];
	return location;

}

/**
 * A floor surface over the whole frame, right-handed with its normal up: u
 * runs along local +x and v along local -z, so a blocker at local (x, z)
 * covers surface (x, -z).
 */
function floorSurface( origin, yaw, width, depth, blockers ) {

	const cosine = round( Math.cos( yaw ) );
	const sine = round( Math.sin( yaw ) );
	const surface = { center: { x: 0, z: 0 }, width, depth };
	return {
		surfaceId: 'floor',
		kind: 'floor',
		origin: { ...origin },
		uAxis: { x: cosine, y: 0, z: -sine },
		vAxis: { x: -sine, y: 0, z: -cosine },
		normal: { x: 0, y: 1, z: 0 },
		width,
		height: depth,
		blockedRegions: blockers
			.map( ( blocker ) => clip( { center: { x: blocker.center.x, z: -blocker.center.z }, width: blocker.width, depth: blocker.depth }, surface ) )
			.filter( Boolean )
	};

}

/** A world point in the frame's local plane, rounded as the frame is. */
function frameLocal( location, point ) {

	const rotated = rotate2( { x: point.x - location.origin.x, z: point.z - location.origin.z }, -location.yawRadians );
	return { x: round( rotated.x ), z: round( rotated.z ) };

}

/** The quarter turn of the outline's longest edge nearest zero, so an axis-aligned room is yaw 0. */
function frameYaw( outline ) {

	let longest = null;
	for ( let index = 0; index < outline.length; index ++ ) {

		const from = outline[ index ];
		const to = outline[ ( index + 1 ) % outline.length ];
		const edge = { x: to.x - from.x, z: to.z - from.z };
		const length = Math.hypot( edge.x, edge.z );
		if ( ! longest || length > longest.length + EPSILON ) longest = { ...edge, length };

	}
	const angle = Math.atan2( -longest.z, longest.x );
	const quarter = Math.PI / 2;
	return zeroed( round( angle - quarter * Math.round( angle / quarter ) ) );

}

/**
 * The unit normal of the lot side nearest the access point, pointing out of
 * the lot: Atlas stands the point on the side that fronts its street.
 */
function frontageNormal( lot, point ) {

	const outline = lot.map( ( [ x, z ] ) => ( { x, z } ) );
	let nearest = null;
	for ( let index = 0; index < outline.length; index ++ ) {

		const a = outline[ index ];
		const b = outline[ ( index + 1 ) % outline.length ];
		const distance = distanceToSegment( point, a, b );
		if ( ! nearest || distance < nearest.distance - EPSILON ) nearest = { a, b, distance };

	}
	const length = Math.hypot( nearest.b.x - nearest.a.x, nearest.b.z - nearest.a.z );
	const normal = { x: ( nearest.b.z - nearest.a.z ) / length, z: -( nearest.b.x - nearest.a.x ) / length };
	const middle = { x: ( nearest.a.x + nearest.b.x ) / 2, z: ( nearest.a.z + nearest.b.z ) / 2 };
	const inward = containsPoint( outline, { x: middle.x + normal.x * 0.01, z: middle.z + normal.z * 0.01 } );
	return inward ? { x: -normal.x, z: -normal.z } : normal;

}

/** A frame's corners in world [x, z], counter-clockwise as the clipping helpers want them. */
function frameRing( frame ) {

	const ring = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ].map( ( [ sx, sz ] ) => {

		const offset = rotate2( { x: sx * frame.width / 2, z: sz * frame.depth / 2 }, frame.yawRadians );
		return [ frame.origin.x + offset.x, frame.origin.z + offset.z ];

	} );
	return signedArea( ring ) < 0 ? ring.reverse() : ring;

}

function signedArea( ring ) {

	let sum = 0;
	for ( let index = 0; index < ring.length; index ++ ) {

		const [ ax, az ] = ring[ index ];
		const [ bx, bz ] = ring[ ( index + 1 ) % ring.length ];
		sum += ax * bz - bx * az;

	}
	return sum / 2;

}

function ringBox( ring ) {

	const xs = ring.map( ( point ) => point[ 0 ] );
	const zs = ring.map( ( point ) => point[ 1 ] );
	return { minX: Math.min( ...xs ), maxX: Math.max( ...xs ), minZ: Math.min( ...zs ), maxZ: Math.max( ...zs ) };

}

function boxesMeet( left, right ) {

	return left.minX < right.maxX && right.minX < left.maxX && left.minZ < right.maxZ && right.minZ < left.maxZ;

}

function zeroed( value ) {

	return Object.is( value, -0 ) ? 0 : value;

}

/**
 * The largest axis-aligned rectangle inside a simple polygon, among those whose
 * sides stand on the polygon's own vertex coordinates.
 */
function largestRectangle( polygon ) {

	const xs = [ ...new Set( polygon.map( ( point ) => round( point.x ) ) ) ].sort( ( a, b ) => a - b );
	const zs = [ ...new Set( polygon.map( ( point ) => round( point.z ) ) ) ].sort( ( a, b ) => a - b );
	let best = null;
	for ( let i = 0; i < xs.length; i ++ ) for ( let j = i + 1; j < xs.length; j ++ ) {

		for ( let k = 0; k < zs.length; k ++ ) for ( let l = k + 1; l < zs.length; l ++ ) {

			const rect = { minX: xs[ i ], maxX: xs[ j ], minZ: zs[ k ], maxZ: zs[ l ] };
			const area = ( rect.maxX - rect.minX ) * ( rect.maxZ - rect.minZ );
			if ( best && area <= best.area + EPSILON ) continue;
			if ( ! insidePolygon( polygon, rect ) ) continue;
			best = { ...rect, area };

		}

	}
	return best;

}

function insidePolygon( polygon, rect ) {

	const corners = [
		{ x: rect.minX, z: rect.minZ }, { x: rect.maxX, z: rect.minZ },
		{ x: rect.maxX, z: rect.maxZ }, { x: rect.minX, z: rect.maxZ },
		{ x: ( rect.minX + rect.maxX ) / 2, z: ( rect.minZ + rect.maxZ ) / 2 }
	];
	if ( ! corners.every( ( corner ) => containsPoint( polygon, corner ) ) ) return false;
	const inner = { minX: rect.minX + EPSILON, maxX: rect.maxX - EPSILON, minZ: rect.minZ + EPSILON, maxZ: rect.maxZ - EPSILON };
	for ( let index = 0; index < polygon.length; index ++ ) {

		if ( segmentCrosses( polygon[ index ], polygon[ ( index + 1 ) % polygon.length ], inner ) ) return false;

	}
	return true;

}

/** Inside or on the outline. */
function containsPoint( polygon, point ) {

	let inside = false;
	for ( let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index ++ ) {

		const a = polygon[ previous ];
		const b = polygon[ index ];
		if ( distanceToSegment( point, a, b ) < 1e-5 ) return true;
		if ( ( a.z > point.z ) !== ( b.z > point.z ) && point.x < ( b.x - a.x ) * ( point.z - a.z ) / ( b.z - a.z ) + a.x ) inside = ! inside;

	}
	return inside;

}

function roomAt( rooms, point ) {

	let nearest = null;
	for ( const room of rooms ) {

		const outline = room.polygon.map( ( [ x, z ] ) => ( { x, z } ) );
		if ( containsPoint( outline, point ) ) return room;
		const distance = Math.min( ...outline.map( ( a, index ) => distanceToSegment( point, a, outline[ ( index + 1 ) % outline.length ] ) ) );
		if ( ! nearest || distance < nearest.distance ) nearest = { room, distance };

	}
	return nearest.room;

}

function segmentCrosses( a, b, rect ) {

	let lo = 0;
	let hi = 1;
	for ( const [ from, to, min, max ] of [ [ a.x, b.x, rect.minX, rect.maxX ], [ a.z, b.z, rect.minZ, rect.maxZ ] ] ) {

		const delta = to - from;
		if ( Math.abs( delta ) < EPSILON ) {

			if ( from <= min || from >= max ) return false;
			continue;

		}
		const first = ( min - from ) / delta;
		const second = ( max - from ) / delta;
		lo = Math.max( lo, Math.min( first, second ) );
		hi = Math.min( hi, Math.max( first, second ) );
		if ( lo >= hi ) return false;

	}
	return true;

}

function distanceToSegment( point, a, b ) {

	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length = dx * dx + dz * dz;
	const t = length ? clamp( ( ( point.x - a.x ) * dx + ( point.z - a.z ) * dz ) / length, 0, 1 ) : 0;
	return Math.hypot( point.x - ( a.x + t * dx ), point.z - ( a.z + t * dz ) );

}

function bounds( points ) {

	const minX = Math.min( ...points.map( ( point ) => point.x ) );
	const maxX = Math.max( ...points.map( ( point ) => point.x ) );
	const minZ = Math.min( ...points.map( ( point ) => point.z ) );
	const maxZ = Math.max( ...points.map( ( point ) => point.z ) );
	return { center: { x: round( ( minX + maxX ) / 2 ), z: round( ( minZ + maxZ ) / 2 ) }, width: round( maxX - minX ), depth: round( maxZ - minZ ) };

}

function overlap( left, right ) {

	return Math.abs( left.center.x - right.center.x ) < ( left.width + right.width ) / 2 &&
		Math.abs( left.center.z - right.center.z ) < ( left.depth + right.depth ) / 2;

}

/** The part of a rectangle inside another centred at the origin, or null. */
function clip( rect, surface ) {

	const minX = Math.max( rect.center.x - rect.width / 2, -surface.width / 2 );
	const maxX = Math.min( rect.center.x + rect.width / 2, surface.width / 2 );
	const minZ = Math.max( rect.center.z - rect.depth / 2, -surface.depth / 2 );
	const maxZ = Math.min( rect.center.z + rect.depth / 2, surface.depth / 2 );
	if ( maxX - minX <= EPSILON || maxZ - minZ <= EPSILON ) return null;
	return { center: { x: round( ( minX + maxX ) / 2 ), z: round( ( minZ + maxZ ) / 2 ) }, width: round( maxX - minX ), depth: round( maxZ - minZ ) };

}

function clamp( value, minimum, maximum ) {

	return Math.max( minimum, Math.min( maximum, value ) );

}

function placeError( message ) {

	return new SceneryError( 'E_SCENERY_PLACE', message );

}

function noFit( message ) {

	return new SceneryError( 'E_SCENERY_NO_FIT', message );

}

