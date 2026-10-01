/** A point stands on the highest floor whose walking surface is at most this far above it, in metres. */
const STEP = 0.5;
/** Where a body treads a flight: across its width, and how far before its foot and past its top it steps on and off. */
const FLIGHT_LINE = 0.725;
const FLIGHT_APPROACH = 0.55;
/** A tread's run and a riser's height in a flight module's own frame (Interior's `stair-flight-N`). */
const TREAD = 0.28;
const RISER = 0.17;
/** An apartment door whose published width is missing is taken this wide. */
const DOOR_WIDTH = 1.6;
/** How far in front of an apartment door, on the corridor side, a guide stands to show it. */
const DOOR_FRONT = 0.9;

/**
 * Walks inside furnished buildings, as NpcContinuity's `interiorRoutes`.
 * Interior publishes each building's navigation (`npc.nav`, floors of
 * walkable cells in world XZ joined by stair and lift connectors), the
 * elevation of every floor, each floor's layout (the stair flights as
 * placements, the lift shafts as rooms) and the numbered apartment entrances;
 * a walk is Interior's `findPath` between two world points, raised onto the
 * floors it crosses. A stair is walked up or down its own flights, tread by
 * tread; a lift is a gate the walker stops at: from the landing it waits at,
 * into the car, up or down the shaft and out onto the landing of its floor.
 * An apartment door the walk passes through is a door gate. Nothing is read
 * from fixed positions: all of it comes from the building's published data.
 */
export class InteriorRoutes {

	/**
	 * @param buildings live Map of parcelId to `{ npc, interior }` as BuildingSource
	 *   reads them; streamed worlds add and drop records as cells load and leave
	 * @param findPath Interior's browser navigation entry (`dist/nav.js`)
	 */
	constructor( buildings, { findPath } ) {

		this.buildings = buildings;
		this.findPath = findPath;
		this.walkable = new WeakMap();

	}

	/** Whether this building is loaded and publishes navigation and its floor elevations. */
	covers( parcelId ) {

		return this.#walkable( parcelId ) !== null;

	}

	/**
	 * A walk inside one building from one world point to another, on or across
	 * its floors, as `{ path3, gates? }` starting and ending at those points;
	 * null when the building has no way between them. `gates` are what the
	 * walker stops at on the way, each measured along `path3`: a lift
	 * `{ kind: 'lift', parcelId, shaft, fromFloor, toFloor, from, board, alight, to }`
	 * (the landing it waits at, where it stands in the car, where the car lets
	 * it out, the landing it walks off to) and a door
	 * `{ kind: 'door', parcelId, floor, at, position }`.
	 */
	route( parcelId, from, to ) {

		const walkable = this.#walkable( parcelId );
		if ( ! walkable ) return null;
		const { nav, levels } = walkable;
		const found = this.findPath( { nav, from: navPoint( levels, from ), to: navPoint( levels, to ) } );
		if ( ! found || found.error ) return null;
		const path3 = [ [ ...from ] ];
		const lifts = [];
		for ( let index = 0; index < found.legs.length; index ++ ) {

			const leg = found.legs[ index ];
			const y = levels.get( leg.floor );
			if ( y === undefined ) return null;
			for ( const [ x, z ] of leg.points ) append( path3, [ x, y, z ] );
			const connector = found.connectors?.[ index ];
			if ( ! connector ) continue;
			if ( connector.kind === 'elevator' ) {

				const shaft = walkable.shafts.get( connector.id );
				const arrive = levels.get( connector.toFloor );
				if ( ! shaft || arrive === undefined ) continue;
				// From the landing into the car and the ride: the gate names each point by its index.
				const landing = path3.length - 1;
				append( path3, [ shaft[ 0 ], y, shaft[ 1 ] ] );
				append( path3, [ shaft[ 0 ], arrive, shaft[ 1 ] ] );
				lifts.push( { connector, landing, car: path3.length - 2, out: path3.length - 1 } );

			} else for ( const point of walkable.flights( connector ) ) append( path3, point );

		}
		append( path3, [ ...to ] );
		if ( path3.length < 2 ) return null;
		const along = distances( path3 );
		const gates = [];
		for ( const { connector, landing, car, out } of lifts ) {

			gates.push( {
				kind: 'lift', parcelId, shaft: connector.id, fromFloor: connector.fromFloor, toFloor: connector.toFloor,
				from: along[ landing ], board: along[ car ], alight: along[ out ], to: along[ Math.min( out + 1, path3.length - 1 ) ]
			} );

		}
		for ( const door of walkable.doors ) gates.push( ...crossings( path3, along, door, parcelId ) );
		gates.sort( ( a, b ) => ( a.at ?? a.from ) - ( b.at ?? b.from ) );
		return gates.length ? { path3, gates } : { path3 };

	}

	/**
	 * The building's circulation as a guide and the talk read it: per floor its
	 * elevation, lift landings and stair entries, its rooms by kind (and unit)
	 * with a point inside each, and the numbered apartment doors with the
	 * corridor point in front of each; null while the building is not loaded.
	 */
	plan( parcelId ) {

		return this.#walkable( parcelId )?.plan ?? null;

	}

	/**
	 * The loaded building's navigation, floor index to walking-surface
	 * elevation, lift shafts, stair flights and apartment doors, kept per
	 * building record; null while the building is not loaded or cannot be walked.
	 */
	#walkable( parcelId ) {

		const building = this.buildings.get( parcelId );
		if ( ! building ) return null;
		if ( ! this.walkable.has( building ) ) this.walkable.set( building, walkable( building ) );
		return this.walkable.get( building );

	}

}

/** A building's circulation (InteriorRoutes `plan`) read straight from its record, or null when it has no navigation or floors. */
export function circulationOf( building ) {

	return walkable( building )?.plan ?? null;

}

function walkable( { npc, interior } ) {

	const nav = npc?.nav;
	const floors = interior?.building?.floors;
	if ( ! nav?.floors?.length || ! floors?.length ) return null;
	const levels = new Map( floors.map( ( floor ) => [ floor.index, floor.elevation ] ) );
	if ( nav.roofAccess ) levels.set( nav.roofAccess.floor, nav.roofAccess.elevation );
	const layoutOf = ( index ) => interior.layouts?.[ floors.find( ( floor ) => floor.index === index )?.layout ];
	// A lift is its shaft room's middle, on whichever floor publishes the room.
	const shafts = new Map();
	for ( const connector of nav.connectors ?? [] ) {

		if ( connector.kind !== 'elevator' ) continue;
		for ( const index of connector.floors ?? [] ) {

			const room = layoutOf( index )?.floor?.rooms?.find( ( candidate ) => candidate.id === connector.id && candidate.polygon?.length );
			if ( ! room ) continue;
			shafts.set( connector.id, centre( room.polygon ) );
			break;

		}

	}
	const doors = [];
	for ( const floor of floors ) for ( const entrance of floor.apartmentEntrances ?? [] ) {

		if ( ! entrance.position || ! entrance.inward ) continue;
		doors.push( {
			floor: floor.index, y: floor.elevation, position: entrance.position, inward: entrance.inward,
			width: entrance.width ?? DOOR_WIDTH, number: entrance.number, unit: entrance.unit
		} );

	}
	return {
		nav, levels, shafts, doors,
		flights: ( connector ) => stairWalk( connector, levels, layoutOf ),
		plan: circulation( nav, floors, levels, layoutOf, doors )
	};

}

/**
 * The tread line a stair connector is walked on between its two floors: up
 * the flights each floor publishes for that stair (`connector` names them),
 * lowest first, or down them in reverse. A stair with no flights published is
 * walked straight between its entries.
 */
function stairWalk( { id, fromFloor, toFloor }, levels, layoutOf ) {

	const points = [];
	for ( let floor = Math.min( fromFloor, toFloor ); floor < Math.max( fromFloor, toFloor ); floor ++ ) {

		const elevation = levels.get( floor );
		if ( elevation === undefined ) continue;
		const flights = ( layoutOf( floor )?.placements ?? [] )
			.filter( ( placement ) => placement.connector === id && placement.module?.startsWith( 'stair-flight-' ) )
			.sort( ( a, b ) => a.position[ 1 ] - b.position[ 1 ] );
		for ( const flight of flights ) {

			const count = Number( flight.module.split( '-' ).at( - 1 ) ) || 1;
			points.push( onFlight( flight, elevation, - FLIGHT_APPROACH, 0 ) );
			for ( let step = 0; step < count; step ++ ) points.push( onFlight( flight, elevation, ( step + 0.5 ) * TREAD, ( step + 1 ) * RISER ) );
			points.push( onFlight( flight, elevation, count * TREAD + FLIGHT_APPROACH, count * RISER ) );

		}

	}
	return toFloor > fromFloor ? points : points.reverse();

}

/** A point of a flight placement's frame in the world: across at the tread line, along its run, up its rise (three's +Y rotation). */
function onFlight( placement, elevation, along, rise ) {

	const x = FLIGHT_LINE * placement.scale[ 0 ];
	const z = along * placement.scale[ 2 ];
	const c = Math.cos( placement.rotationY );
	const s = Math.sin( placement.rotationY );
	return [
		placement.position[ 0 ] + x * c + z * s,
		elevation + placement.position[ 1 ] + rise * placement.scale[ 1 ],
		placement.position[ 2 ] - x * s + z * c
	];

}

/** Where a walk crosses one apartment door's line on the door's floor, as door gates. */
function crossings( path3, along, door, parcelId ) {

	const half = door.width / 2;
	const across = [ - door.inward[ 1 ], door.inward[ 0 ] ];
	const a = [ door.position[ 0 ] - across[ 0 ] * half, door.position[ 1 ] - across[ 1 ] * half ];
	const b = [ door.position[ 0 ] + across[ 0 ] * half, door.position[ 1 ] + across[ 1 ] * half ];
	const gates = [];
	for ( let index = 1; index < path3.length; index ++ ) {

		const p = path3[ index - 1 ];
		const q = path3[ index ];
		if ( Math.abs( p[ 1 ] - door.y ) > STEP || Math.abs( q[ 1 ] - door.y ) > STEP ) continue;
		const t = intersect( [ p[ 0 ], p[ 2 ] ], [ q[ 0 ], q[ 2 ] ], a, b );
		if ( t === null ) continue;
		gates.push( {
			kind: 'door', parcelId, floor: door.floor, at: along[ index - 1 ] + ( along[ index ] - along[ index - 1 ] ) * t,
			position: [ door.position[ 0 ], door.y, door.position[ 1 ] ]
		} );

	}
	return gates;

}

/**
 * What a building's circulation offers a guide: per floor its lift landings
 * and stair entries (from the navigation connectors), its rooms by kind with a
 * point inside each (the stair and lift shafts left out), and the apartment
 * doors with the corridor point in front of each.
 */
function circulation( nav, floors, levels, layoutOf, doors ) {

	const plan = [];
	for ( const floor of [ ...floors ].sort( ( a, b ) => a.index - b.index ) ) {

		const y = levels.get( floor.index );
		const lifts = [];
		const stairs = [];
		for ( const connector of nav.connectors ?? [] ) {

			const entry = connector.entryByFloor?.[ floor.index ] ?? connector.entryByFloor?.[ String( floor.index ) ];
			if ( ! entry ) continue;
			( connector.kind === 'elevator' ? lifts : stairs ).push( { id: connector.id, position: [ entry[ 0 ], y, entry[ 1 ] ] } );

		}
		const rooms = ( layoutOf( floor.index )?.floor?.rooms ?? [] )
			.filter( ( room ) => room.polygon?.length && ! /^(stair|elev)/.test( room.id ) )
			.map( ( room ) => {

				const [ x, z ] = centre( room.polygon );
				return { id: `floor:${floor.index}/${room.id}`, kind: room.kind, ...( room.unit ? { unit: room.unit } : {} ), position: [ x, y, z ] };

			} );
		plan.push( { index: floor.index, elevation: y, lifts, stairs, rooms } );

	}
	return {
		floors: plan,
		apartments: doors.map( ( door ) => ( {
			floor: door.floor, unit: door.unit, ...( door.number ? { number: String( door.number ) } : {} ),
			door: [ door.position[ 0 ], door.y, door.position[ 1 ] ],
			front: [ door.position[ 0 ] - door.inward[ 0 ] * DOOR_FRONT, door.y, door.position[ 1 ] - door.inward[ 1 ] * DOOR_FRONT ]
		} ) )
	};

}

/** The navigation floor and XZ of a world point: the highest floor at or just above its feet. */
function navPoint( levels, [ x, y, z ] ) {

	let floor = null;
	for ( const [ index, elevation ] of levels ) {

		if ( elevation > y + STEP ) continue;
		if ( floor === null || elevation > levels.get( floor ) ) floor = index;

	}
	floor ??= [ ...levels ].sort( ( a, b ) => a[ 1 ] - b[ 1 ] )[ 0 ][ 0 ];
	return { floor, x, z };

}

/** Where segment pq meets segment ab, as a share of pq, or null. */
function intersect( p, q, a, b ) {

	const r = [ q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] ];
	const s = [ b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] ];
	const denominator = r[ 0 ] * s[ 1 ] - r[ 1 ] * s[ 0 ];
	if ( Math.abs( denominator ) < 1e-9 ) return null;
	const t = ( ( a[ 0 ] - p[ 0 ] ) * s[ 1 ] - ( a[ 1 ] - p[ 1 ] ) * s[ 0 ] ) / denominator;
	const u = ( ( a[ 0 ] - p[ 0 ] ) * r[ 1 ] - ( a[ 1 ] - p[ 1 ] ) * r[ 0 ] ) / denominator;
	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;

}

function centre( polygon ) {

	let x = 0;
	let z = 0;
	for ( const point of polygon ) {

		x += point[ 0 ];
		z += point[ 1 ];

	}
	return [ x / polygon.length, z / polygon.length ];

}

function distances( path ) {

	const out = [ 0 ];
	for ( let index = 1; index < path.length; index ++ ) {

		const a = path[ index - 1 ];
		const b = path[ index ];
		out.push( out[ index - 1 ] + Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ) );

	}
	return out;

}

function append( path, point ) {

	const last = path.at( - 1 );
	if ( ! last || Math.hypot( point[ 0 ] - last[ 0 ], point[ 1 ] - last[ 1 ], point[ 2 ] - last[ 2 ] ) > 1e-6 ) path.push( point );

}
