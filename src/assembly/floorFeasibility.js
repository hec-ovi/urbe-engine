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

/** Family bounds with the published default clear-height policy applied. */
export function constantsForType( floorConstants, type ) {

	const family = floorConstants.constants[ floorConstants.families[ type ] ];
	const policy = floorConstants.generationPolicy;
	return { ...family, minFloorHeight: Math.max( family.minFloorHeight, policy.defaultClearHeight + policy.clearHeightAllowance ) };

}

/**
 * Legal floor count range using the active generation-policy minimum. reqH(b) is the tallest walkable
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

		if ( a.kind === 'wire-anchor' || a.base < 0 ) continue;

		reqHByBase.set( a.base, Math.max( reqHByBase.get( a.base ) ?? 0, a.height ) );

	}

	if ( reqHByBase.size === 0 ) {

		const max = Math.floor( maxHeight / minFloorHeight );

		return max >= 1 ? { min: 1, max } : null;

	}

	const bases = [ ...reqHByBase.keys() ].filter( base => base > 0 ).sort( ( a, b ) => a - b );

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
	let previousReqH = reqHByBase.get( 0 ) ?? 0;

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

/** Descending fixed bases retain their exact gaps and the aperture hosted at each lower base. */
export function feasibleBasementRange( { apertures, minFloorHeight, maxFloorHeight } ) {

	const required = new Map();
	for ( const aperture of apertures ) {

		if ( aperture.kind === 'wire-anchor' || aperture.base >= 0 ) continue;
		const depth = - aperture.base;
		required.set( depth, Math.max( required.get( depth ) ?? 0, aperture.height ) );

	}
	let previous = 0, min = 0, max = 0;
	for ( const depth of [ ...required.keys() ].sort( ( a, b ) => a - b ) ) {

		const height = required.get( depth ), gap = depth - previous;
		if ( height > maxFloorHeight || gap < Math.max( height, minFloorHeight ) ) return null;
		const low = Math.ceil( gap / maxFloorHeight );
		const high = 1 + Math.floor( ( gap - Math.max( height, minFloorHeight ) ) / minFloorHeight );
		if ( low > high ) return null;
		min += low; max += high; previous = depth;

	}
	return { min, max };

}
