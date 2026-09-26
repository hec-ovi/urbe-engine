/** A point stands on the highest floor whose walking surface is at most this far above it, in metres. */
const STEP = 0.5;

/**
 * Walks inside furnished buildings, as NpcContinuity's `interiorRoutes`.
 * Interior publishes each building's navigation (`npc.nav`, floors of
 * walkable cells in world XZ joined by stair and lift connectors) and the
 * elevation of every floor; a walk is Interior's `findPath` between two world
 * points, raised onto the floors it crosses.
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
	 * its floors, as `{ path3 }` starting and ending at those points; null when
	 * the building has no way between them.
	 */
	route( parcelId, from, to ) {

		const walkable = this.#walkable( parcelId );
		if ( ! walkable ) return null;
		const { nav, levels } = walkable;
		const found = this.findPath( { nav, from: navPoint( levels, from ), to: navPoint( levels, to ) } );
		if ( ! found || found.error ) return null;
		const path3 = [ [ ...from ] ];
		for ( const leg of found.legs ) {

			const y = levels.get( leg.floor );
			if ( y === undefined ) return null;
			for ( const [ x, z ] of leg.points ) append( path3, [ x, y, z ] );

		}
		append( path3, [ ...to ] );
		return path3.length > 1 ? { path3 } : null;

	}

	/**
	 * The loaded building's navigation and floor index to walking-surface
	 * elevation, kept per building record; null while the building is not
	 * loaded or cannot be walked.
	 */
	#walkable( parcelId ) {

		const building = this.buildings.get( parcelId );
		if ( ! building ) return null;
		if ( ! this.walkable.has( building ) ) this.walkable.set( building, walkable( building ) );
		return this.walkable.get( building );

	}

}

function walkable( { npc, interior } ) {

	const nav = npc?.nav;
	const floors = interior?.building?.floors;
	if ( ! nav?.floors?.length || ! floors?.length ) return null;
	const levels = new Map( floors.map( ( floor ) => [ floor.index, floor.elevation ] ) );
	if ( nav.roofAccess ) levels.set( nav.roofAccess.floor, nav.roofAccess.elevation );
	return { nav, levels };

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

function append( path, point ) {

	const last = path.at( - 1 );
	if ( ! last || Math.hypot( point[ 0 ] - last[ 0 ], point[ 1 ] - last[ 1 ], point[ 2 ] - last[ 2 ] ) > 1e-6 ) path.push( point );

}
