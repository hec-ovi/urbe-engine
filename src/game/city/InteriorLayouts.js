/**
 * One furnished building's floors, from the three layouts it reuses.
 *
 * Interior publishes a building as a ground layout, one middle layout shared
 * by every middle floor and a crown layout, each a table of module and prop
 * placements in its own floor's frame with the walking surface at zero. A
 * floor here is that table plus the elevation the building puts it at, so the
 * middle floors of a tower differ by one number and nothing else.
 */

const LAYOUTS = [ 'ground', 'middle', 'crown' ];

/**
 * @param parcelId the parcel the building stands on
 * @param interior `{ building, layouts }` as BuildingSource reads them
 * @returns one record per floor, lowest first
 */
export function buildingFloors( parcelId, { building, layouts } ) {

	if ( ! building?.floors?.length ) throw layoutError( `${parcelId} publishes no floors` );

	return [ ...building.floors ]
		.sort( ( a, b ) => a.index - b.index )
		.map( ( entry ) => floorOf( parcelId, entry, layouts?.[ entry.layout ] ) );

}

function floorOf( parcelId, entry, layout ) {

	if ( ! LAYOUTS.includes( entry.layout ) ) throw layoutError( `${parcelId} floor ${entry.index} names layout ${entry.layout}` );
	if ( ! layout ) throw layoutError( `${parcelId} floor ${entry.index} has no ${entry.layout} layout` );

	const source = layout.floor;
	const { elevation } = entry;

	return {
		id: `${parcelId}:${entry.index}`,
		parcelId,
		floor: entry.index,
		layout: entry.layout,
		elevation,
		height: source.height,
		rooms: source.rooms,
		core: source.core,
		// A layout's fixtures are measured from its own walking surface; a floor's
		// are where they hang in the world.
		lights: ( source.lights ?? [] ).map( ( light ) => ( {
			...light,
			position: [ light.position[ 0 ], light.position[ 1 ] + elevation, light.position[ 2 ] ]
		} ) ),
		// The layout's placements are one record every floor of the band shares;
		// a floor's window returns are its own, built from its own openings.
		placements: layout.placements,
		treatments: entry.treatments ?? []
	};

}

export function layoutError( message ) {

	return Object.assign( new Error( `E_INTERIOR_LAYOUT: ${message}` ), { code: 'E_INTERIOR_LAYOUT' } );

}

/** Everything a floor draws: the placements of the layout it shares, then its own window returns. */
export function floorPlacements( floor ) {

	return floor.treatments?.length ? floor.placements.concat( floor.treatments ) : floor.placements;

}
