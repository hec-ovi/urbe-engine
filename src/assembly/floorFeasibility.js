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
 * Legal floor count range per the recipe. reqH(b) is the tallest walkable
 * aperture height at base b: the floor pinned at b must contain the aperture's
 * full vertical extent, so every reqH must fit maxFloorHeight, each gap from a
 * base to the next must hold at least max(reqH, minFloorHeight) and admits
 * ceil(g / maxFloorHeight) to (reqH > minFloorHeight
 * ? 1 + floor((g - reqH) / minFloorHeight) : floor(g / minFloorHeight)) floors,
 * and the tail above the top base fills the remaining height the same way.
 * Wire anchors pin no floor plate and are ignored.
 *
 * @returns { min, max } or null when no count is feasible.
 */
export function feasibleFloorRange( { maxHeight, apertures, minFloorHeight, maxFloorHeight } ) {

	const reqHByBase = new Map();

	for ( const a of apertures ) {

		if ( a.kind === 'wire-anchor' || a.base <= 0 ) continue;

		reqHByBase.set( a.base, Math.max( reqHByBase.get( a.base ) ?? 0, a.height ) );

	}

	if ( reqHByBase.size === 0 ) {

		const max = Math.floor( maxHeight / minFloorHeight );

		return max >= 1 ? { min: 1, max } : null;

	}

	const bases = [ ...reqHByBase.keys() ].sort( ( a, b ) => a - b );

	for ( const reqH of reqHByBase.values() ) {

		if ( reqH > maxFloorHeight ) return null;

	}

	const gapMaxFloors = ( gap, reqH ) =>
		reqH > minFloorHeight
			? 1 + Math.floor( ( gap - reqH ) / minFloorHeight )
			: Math.floor( gap / minFloorHeight );

	let min = 0;
	let max = 0;
	let previous = 0;
	let previousReqH = 0;

	for ( const base of bases ) {

		const gap = base - previous;

		if ( gap < Math.max( previousReqH, minFloorHeight ) ) return null;

		const gapMin = Math.ceil( gap / maxFloorHeight );
		const gapMax = gapMaxFloors( gap, previousReqH );

		if ( gapMin > gapMax ) return null;

		min += gapMin;
		max += gapMax;
		previous = base;
		previousReqH = reqHByBase.get( base );

	}

	const room = maxHeight - previous;

	if ( room < Math.max( previousReqH, minFloorHeight ) ) return null;

	return {
		min: min + 1,
		max: max + gapMaxFloors( room, previousReqH )
	};

}
