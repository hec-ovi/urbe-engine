import { readFileSync } from 'node:fs';

/**
 * Exterior's floor feasibility surface (../exterior/schemas/floor-constants.json):
 * the constants the generator enforces and its recipe for the legal floor count range.
 */

const CONSTANTS_PATH = new URL( '../../../exterior/schemas/floor-constants.json', import.meta.url );

let cached = null;

/** Loads the constants file once. */
export function loadFloorConstants() {

	if ( ! cached ) cached = JSON.parse( readFileSync( CONSTANTS_PATH, 'utf8' ) );

	return cached;

}

/** Per-family constants for an atlas building type. */
export function constantsForType( floorConstants, type ) {

	return floorConstants.constants[ floorConstants.families[ type ] ];

}

/**
 * Legal floor count range per the recipe: sort the distinct walkable aperture
 * bases above ground; each gap admits ceil(g / maxFloorHeight) to
 * floor(g / minFloorHeight) floors, the top base needs minFloorHeight of room
 * below maxHeight, and the floors above it fill the remaining height.
 * Wire anchors pin no floor plate and are ignored.
 *
 * @returns { min, max } or null when no count is feasible.
 */
export function feasibleFloorRange( { maxHeight, apertures, minFloorHeight, maxFloorHeight } ) {

	const bases = [ ...new Set(
		apertures
			.filter( ( a ) => a.kind !== 'wire-anchor' && a.base > 0 )
			.map( ( a ) => a.base )
	) ].sort( ( a, b ) => a - b );

	if ( bases.length === 0 ) {

		const max = Math.floor( maxHeight / minFloorHeight );

		return max >= 1 ? { min: 1, max } : null;

	}

	const topBase = bases[ bases.length - 1 ];

	if ( topBase + minFloorHeight > maxHeight ) return null;

	let min = 0;
	let max = 0;
	let previous = 0;

	for ( const base of bases ) {

		const gap = base - previous;
		const gapMin = Math.ceil( gap / maxFloorHeight );
		const gapMax = Math.floor( gap / minFloorHeight );

		if ( gapMin > gapMax ) return null;

		min += gapMin;
		max += gapMax;
		previous = base;

	}

	return {
		min: min + 1,
		max: max + Math.floor( ( maxHeight - topBase ) / minFloorHeight )
	};

}
