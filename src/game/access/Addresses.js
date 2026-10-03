
/** A point stands on the highest floor whose walking surface is at most this far above it, in metres. */
const STEP = 0.5;
/** How far in front of a door, on its public side, somebody stands to be at it. */
const DOOR_FRONT = 0.9;
/** A private room's doorway the engine can close: Interior's door sizes. */
const DOOR_WIDTH = [ 0.7, 2.4 ];

/**
 * The rooms behind a locked door, by kind: the scope a card needs to open
 * them (see Access.js). A storage room whose role is an archive is a staff
 * room, and a room whose role names security, servers or a control room is a
 * security room, whatever its kind.
 */
export const PRIVATE_ROOMS = Object.freeze( {
	office_private: 'staff', executive_office: 'staff', kitchen: 'staff',
	storage: 'service', mechanical_room: 'service'
} );
const SECURITY = /security|server|control|surveillance|vault/;
/** What a private room is called in an address, by kind, role or scope. */
const ROOM_WORDS = Object.freeze( {
	office_private: 'office', executive_office: 'executive office', kitchen: 'kitchen', storage: 'storage room',
	mechanical_room: 'plant room', locker_room: 'locker room', archive: 'archive', server: 'server room', security: 'security room'
} );
/** What a room people share is called where somebody stands. */
const SHARED_WORDS = Object.freeze( {
	elevator_lobby: 'lift lobby', office_open: 'open office', dining_area: 'dining room', counter_area: 'counter', living: 'living room',
	sales_floor: 'shop floor', studio_main: 'studio', gym_floor: 'gym', terrace_open: 'terrace', parking_area: 'car park'
} );

/**
 * Every private space of the furnished buildings, by a stable human address,
 * derived at load from what the worlds already publish: Interior's numbered
 * apartment entrances (`building.floors[].apartmentEntrances`) and the rooms
 * of each floor's layout. A dwelling is `apartment 1407` on its floor, the
 * number on its door; a private room (an office, a store, a plant room, a
 * kitchen behind a counter, a security or server room) is numbered on its
 * floor after the floor's apartments, in plan order: `office 305`, and on
 * the ground floor and below `storage room G01`, `server room B2-01`. A
 * floor is told as its apartments number it (`floor 14`), `ground floor`
 * where none does and the floor is the lowest above ground.
 *
 * Nothing here is a coordinate a person or a model reasons with: the host
 * resolves an address to the unit's entry door and the walk there.
 */
export class AddressBook {

	/**
	 * @param buildings live Map of parcelId to `{ npc, interior }`, as BuildingSource reads them
	 * @param nameOf `( parcelId ) => { name?, word?, street? }`: the building's own name, what it is
	 *   (`apartment block`) and the street it stands on, as the city names them
	 */
	constructor( { buildings, nameOf = () => ( {} ) } ) {

		this.buildings = buildings;
		this.nameOf = nameOf;
		this.cache = new WeakMap();

	}

	/** One building's addresses, or null when it is not a furnished building. */
	building( parcelId ) {

		const record = this.buildings.get( parcelId );
		if ( ! record?.interior?.building?.floors?.length ) return null;
		if ( ! this.cache.has( record ) ) this.cache.set( record, buildingAddresses( parcelId, record, this.nameOf( parcelId ) ?? {} ) );
		return this.cache.get( record );

	}

	/** The unit an id names (`apartment:<parcel>:<home>` or `room:<parcel>:<floor>:<room>`), or null. */
	unit( id ) {

		const parcelId = String( id ?? '' ).split( ':' )[ 1 ];
		return parcelId ? this.building( parcelId )?.units.find( ( unit ) => unit.id === id ) ?? null : null;

	}

	/** A person's own dwelling, the simulation's `home.apartment`, or null. */
	home( npc ) {

		const apartment = npc?.home?.apartment;
		if ( ! apartment ) return null;
		return this.unit( `apartment:${npc.home.parcelId}:${apartment.id}` );

	}

	/**
	 * Where a person works, by address: the room of their role's post in the
	 * building (`{ parcelId, floor, display, floorLabel, unit?, room?, label, address }`,
	 * `unit` when the post is a private room), or the building alone when it
	 * publishes no post for the role; null with no building job.
	 */
	work( npc ) {

		const parcelId = npc?.job?.parcelId;
		if ( ! parcelId ) return null;
		const building = this.building( parcelId );
		if ( ! building ) return { parcelId, label: '', address: this.#name( parcelId ) };
		const record = this.buildings.get( parcelId );
		const slot = record.npc?.roles?.find( ( role ) => role.role === npc.job.role );
		const anchor = slot ? record.npc?.anchors?.find( ( entry ) => entry.id === slot.homeAnchor ) : null;
		if ( ! anchor ) return { parcelId, label: '', address: building.name };
		const floor = building.floors.get( anchor.floor );
		const elevation = floor?.elevation ?? 0;
		return this.at( parcelId, [ anchor.position[ 0 ], elevation, anchor.position[ 1 ] ] ) ?? { parcelId, label: '', address: building.name };

	}

	/**
	 * Where a world point stands in a furnished building: the floor (index,
	 * as the address numbers it and in words), the dwelling or private room
	 * it is in, and the kind of room, with the address that says it all;
	 * null outside the building's floors.
	 */
	at( parcelId, [ x, y, z ] ) {

		const building = this.building( parcelId );
		if ( ! building ) return null;
		let floor = null;
		for ( const entry of building.floors.values() ) {

			if ( entry.elevation > y + STEP ) continue;
			if ( ! floor || entry.elevation > floor.elevation ) floor = entry;

		}
		floor ??= [ ...building.floors.values() ].sort( ( a, b ) => a.elevation - b.elevation )[ 0 ];
		if ( ! floor ) return null;
		const room = floor.rooms.find( ( candidate ) => candidate.polygon?.length >= 3 && contains( candidate, [ x, z ] ) ) ?? null;
		const unit = room ? building.unitOfRoom( floor.index, room ) : null;
		const kind = room ? roomWord( room ) : null;
		const label = unit ? unit.label : kind ?? '';
		return {
			parcelId, floor: floor.index, display: floor.display, floorLabel: floor.label,
			...( unit ? { unit } : {} ), ...( kind ? { room: kind } : {} ), label,
			address: [ building.name, floor.label, ...( label ? [ label ] : [] ) ].join( ', ' )
		};

	}

	/**
	 * The units a line names by number or by what they are: `1407`,
	 * `apartment 1407`, `office 305`, `storage room G01`. `parcelIds` limits
	 * the buildings searched, every furnished one when absent; a bare number
	 * matches only in those, so it never names a door across town by chance.
	 */
	find( text, parcelIds = null ) {

		const words = String( text ?? '' ).toLowerCase();
		const numbers = new Set( words.match( /\b(?:[gb]\d?-?)?\d{2,4}\b/g ) ?? [] );
		if ( ! numbers.size ) return [];
		const ids = parcelIds ?? [ ...this.buildings.keys() ];
		const found = [];
		for ( const parcelId of ids ) {

			for ( const unit of this.building( parcelId )?.units ?? [] ) {

				if ( numbers.has( unit.number.toLowerCase() ) || numbers.has( unit.number.toLowerCase().replace( '-', '' ) ) ) found.push( unit );

			}

		}
		return found;

	}

	/** The building's name for a parcel the book holds no floors for. */
	#name( parcelId ) {

		return buildingName( this.nameOf( parcelId ) ?? {} ).name;

	}

}

/**
 * One furnished building's addresses: its name, its floors (index to
 * `{ index, elevation, display, label, rooms }`) and its units, dwellings
 * first, each `{ id, kind: 'apartment' | 'room', parcelId, floor, display,
 * number, label, address, scope, rooms, doors }`, where `rooms` are the room
 * ids on each floor that make it up and `doors` its entries, each
 * `{ floor, position: [x, z], inward: [x, z], width, front: [x, y, z] }`, the
 * corridor side of the door at `front`.
 */
export function buildingAddresses( parcelId, { interior }, naming = {} ) {

	const { name, short } = buildingName( naming );
	const layoutOf = ( floor ) => interior.layouts?.[ floor.layout ]?.floor ?? null;
	const offset = displayOffset( interior.building.floors );
	const floors = new Map();
	for ( const floor of [ ...interior.building.floors ].sort( ( a, b ) => a.index - b.index ) ) {

		const layout = layoutOf( floor );
		if ( layout?.kind === 'roof' ) continue;
		const display = floor.index + offset;
		floors.set( floor.index, {
			index: floor.index, elevation: floor.elevation ?? 0, display, label: floorLabel( display ),
			rooms: ( layout?.rooms ?? [] ).filter( ( room ) => ! /^(stair|elev)/.test( room.id ) )
		} );

	}

	const units = [];
	// Dwellings: one per numbered entrance, its rooms the layout rooms of the entrance's unit.
	const slots = new Map();
	for ( const floor of interior.building.floors ) {

		const entry = floors.get( floor.index );
		for ( const entrance of floor.apartmentEntrances ?? [] ) {

			if ( ! entrance.number || ! entrance.position || ! entrance.inward ) continue;
			const number = String( entrance.number );
			const display = Number( number.slice( 0, - 2 ) );
			const homeId = `floor:${floor.index}/${entrance.unit}`;
			const label = `apartment ${number}`;
			const door = doorRecord( floor.index, floor.elevation ?? 0, entrance.position, entrance.inward, entrance.width );
			units.push( {
				id: `apartment:${parcelId}:${homeId}`, kind: 'apartment', parcelId, floor: floor.index, display,
				number, label, short: `${short} ${number}`,
				address: `${name}, ${floorLabel( display )}, ${label}`,
				homeId, unitId: entrance.unit, scope: `home:${parcelId}/${homeId}`,
				rooms: entry ? entry.rooms.filter( ( room ) => room.unit === entrance.unit ).map( ( room ) => room.id ) : [],
				doors: [ door ]
			} );
			slots.set( floor.index, Math.max( slots.get( floor.index ) ?? 0, Number( number.slice( - 2 ) ) || 0 ) );

		}

	}
	// Private rooms: numbered on their floor after its dwellings, in plan order.
	for ( const floor of floors.values() ) {

		const byId = new Map( floor.rooms.map( ( room ) => [ room.id, room ] ) );
		const rooms = floor.rooms.filter( ( room ) => ! room.unit && scopeKind( room ) ).sort( planOrder );
		let slot = slots.get( floor.index ) ?? 0;
		for ( const room of rooms ) {

			const doors = roomDoors( room, floor, byId );
			if ( ! doors.length ) continue;
			slot += 1;
			const number = roomNumber( floor.display, slot );
			const label = `${roomWord( room )} ${number}`;
			units.push( {
				id: `room:${parcelId}:${floor.index}:${room.id}`, kind: 'room', parcelId, floor: floor.index, display: floor.display,
				number, label, short: `${short} ${label}`, address: `${name}, ${floor.label}, ${label}`,
				roomId: room.id, roomKind: room.kind, scope: `${scopeKind( room )}:${parcelId}`,
				rooms: [ room.id ], doors
			} );

		}

	}

	const byRoom = new Map();
	for ( const unit of units ) for ( const roomId of unit.rooms ) byRoom.set( `${unit.floor}/${roomId}`, unit );
	return {
		parcelId, name, short, offset, floors, units,
		/** The dwelling or private room a room of a floor belongs to; an upper storey of a duplex belongs to its entrance below. */
		unitOfRoom( index, room ) {

			const own = byRoom.get( `${index}/${room.id}` );
			if ( own ) return own;
			if ( ! room.unit ) return null;
			return units.find( ( unit ) => unit.kind === 'apartment' && unit.unitId === room.unit && ( unit.floor === index || unit.floor === index - 1 ) ) ?? null;

		}
	};

}

/** The scope kind a room's door needs: `staff`, `service` or `security`, or null for a room people share. */
export function scopeKind( room ) {

	if ( SECURITY.test( room.role ?? '' ) ) return 'security';
	if ( room.kind === 'storage' && /archive|records/.test( room.role ?? '' ) ) return 'staff';
	return PRIVATE_ROOMS[ room.kind ] ?? null;

}

/** What a room is called: a private room by its role or kind, a shared one by its kind in words. */
export function roomWord( room ) {

	const role = room.role ?? '';
	if ( /server/.test( role ) ) return ROOM_WORDS.server;
	if ( SECURITY.test( role ) ) return ROOM_WORDS.security;
	if ( room.kind === 'storage' && /archive|records/.test( role ) ) return ROOM_WORDS.archive;
	return ROOM_WORDS[ room.kind ] ?? SHARED_WORDS[ room.kind ] ?? String( room.kind ?? '' ).replace( /_/g, ' ' );

}

/** "floor 14", "ground floor", "basement 2". */
export function floorLabel( display ) {

	if ( display === 0 ) return 'ground floor';
	if ( display < 0 ) return `basement ${- display}`;
	return `floor ${display}`;

}

/** A private room's number on its floor: `305`, `G01` on the ground floor, `B2-01` below it. */
export function roomNumber( display, slot ) {

	const two = String( slot ).padStart( 2, '0' );
	if ( display === 0 ) return `G${two}`;
	if ( display < 0 ) return `B${- display}-${two}`;
	return `${display}${two}`;

}

/** A building's name in an address and on a card: its own name, else what it is and its street. */
export function buildingName( { name = null, word = null, street = null } = {} ) {

	if ( name ) return { name, short: name };
	const what = word ?? 'building';
	if ( street ) return { name: `the ${what} on ${street}`, short: street };
	return { name: `the ${what}`, short: what.replace( /^./, ( c ) => c.toUpperCase() ) };

}

/**
 * How a building's apartment numbers count its floors: a number's leading
 * digits are its storey as the residents say it, which Interior counts from
 * one when there is no lobby under the homes. Zero for a building with no
 * numbered door, whose lowest floor above ground is then the ground floor.
 */
function displayOffset( floors ) {

	for ( const floor of floors ) {

		const number = floor.apartmentEntrances?.find( ( entrance ) => /^\d{3,4}$/.test( String( entrance.number ?? '' ) ) )?.number;
		if ( number ) return Number( String( number ).slice( 0, - 2 ) ) - floor.index;

	}
	return 0;

}

/** The doors into a private room from the rooms around it, each a door record with its public side. */
function roomDoors( room, floor, byId ) {

	const found = [];
	const seen = new Set();
	const add = ( door, from ) => {

		if ( door.kind === 'openFront' || ! door.position ) return;
		if ( door.width < DOOR_WIDTH[ 0 ] || door.width > DOOR_WIDTH[ 1 ] ) return;
		const key = `${door.position[ 0 ].toFixed( 2 )}:${door.position[ 1 ].toFixed( 2 )}`;
		if ( seen.has( key ) ) return;
		const inward = inwardOf( door, room );
		if ( ! inward ) return;
		seen.add( key );
		found.push( { ...doorRecord( floor.index, floor.elevation, door.position, inward, door.width ), connection: door.id, from } );

	};
	for ( const door of room.doors ?? [] ) {

		const other = byId.get( door.to );
		if ( other && scopeKind( other ) && ! other.unit ) continue;
		add( door, door.to );

	}
	for ( const other of byId.values() ) {

		if ( other === room ) continue;
		for ( const door of other.doors ?? [] ) if ( door.to === room.id && ! scopeKind( other ) ) add( door, other.id );

	}
	return found;

}

/** The unit normal of a door's wall that points into the room, or null when neither side is inside it. */
function inwardOf( door, room ) {

	const radians = ( door.angleDeg ?? 0 ) * Math.PI / 180;
	// Plus zero: a wall along an axis has a normal of 0, never -0.
	const normal = [ - Math.sin( radians ) + 0, Math.cos( radians ) + 0 ];
	const probe = ( sign ) => [ door.position[ 0 ] + normal[ 0 ] * 0.15 * sign, door.position[ 1 ] + normal[ 1 ] * 0.15 * sign ];
	if ( contains( room, probe( 1 ) ) ) return normal;
	if ( contains( room, probe( - 1 ) ) ) return [ - normal[ 0 ], - normal[ 1 ] ];
	return null;

}

function doorRecord( floor, elevation, position, inward, width = 1.6 ) {

	return {
		floor, position: [ position[ 0 ], position[ 1 ] ], inward: [ inward[ 0 ], inward[ 1 ] ], width,
		at: [ position[ 0 ], elevation, position[ 1 ] ],
		front: [ position[ 0 ] - inward[ 0 ] * DOOR_FRONT, elevation, position[ 1 ] - inward[ 1 ] * DOOR_FRONT ]
	};

}

/** Rooms in plan order: by where they stand, front to back, left to right, then by id. */
function planOrder( a, b ) {

	const [ ax, az ] = middle( a.polygon );
	const [ bx, bz ] = middle( b.polygon );
	return Math.round( az - bz ) || Math.round( ax - bx ) || a.id.localeCompare( b.id );

}

/**
 * Whether a room's footprint holds a point: inside its outline, its edge
 * included, and outside every hole in it. Kept here, apart from Interior's
 * own footprint test, so the server can read addresses with plain Node.
 */
function contains( room, point ) {

	if ( ! within( room.polygon, point, true ) ) return false;
	return ! ( room.holes ?? [] ).some( ( hole ) => within( hole, point, false ) );

}

/** Even-odd point in polygon; a point on an edge counts as `edge`. */
function within( ring, [ x, z ], edge ) {

	let inside = false;
	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ xi, zi ] = ring[ i ];
		const [ xj, zj ] = ring[ j ];
		const cross = ( xj - xi ) * ( z - zi ) - ( zj - zi ) * ( x - xi );
		const onSegment = Math.abs( cross ) < 1e-9 && x >= Math.min( xi, xj ) - 1e-9 && x <= Math.max( xi, xj ) + 1e-9
			&& z >= Math.min( zi, zj ) - 1e-9 && z <= Math.max( zi, zj ) + 1e-9;
		if ( onSegment ) return edge;
		if ( ( zi > z ) !== ( zj > z ) && x < ( xj - xi ) * ( z - zi ) / ( zj - zi ) + xi ) inside = ! inside;

	}
	return inside;

}

/** The mean of a ring's points. */
function middle( ring = [] ) {

	if ( ! ring.length ) return [ 0, 0 ];
	return ring.reduce( ( sum, [ x, z ] ) => [ sum[ 0 ] + x / ring.length, sum[ 1 ] + z / ring.length ], [ 0, 0 ] );

}
