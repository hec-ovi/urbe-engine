/**
 * Which approved Exterior family a building may wear, and how tall it may stand.
 *
 * Seven facade designs are approved at full detail. Six of them dress ordinary
 * lots; garden taper is the landmark design and stands only on a unique
 * building. A lot that fits none of them gets Exterior's ordinary output, which
 * is a building in its own right and not a fallback: mid and poor streets take
 * it, and a rich one only on a lot of two bays, which every family is too broad
 * for.
 *
 * The minima are each family's published free-standing dimensions in metres
 * (../../../../exterior/src/families/<id>/CONTRACT.md), since a plan is drawn on
 * an open rectangle with no fixed face. They are oriented: `across` runs along
 * face 0, the entrance face, and `deep` away from it, because Exterior fits a
 * family on the plate as it is turned and never swaps its axes. A kit lot is
 * whole 8 m bays, so those metres round up to the bay count that clears them:
 * white grid's 17.5 m and balcony grid's 20.5 m both ask for three bays, which
 * is 24 m, and mirror shutters' 29 by 19 m asks for four across and three deep.
 */

/** The bay every Atlas lot edge is a whole number of. */
export const BAY = 8;
/** A shared building starts at a ground and a crown, so two floors. */
export const MIN_FLOORS = 2;
/** What a storey costs in height, which is what caps a lot's floor count. */
export const PITCH = 4.5;
/** The streets the luxury families stand on. */
const LUXURY = new Set( [ 'rich', 'high_rich' ] );

const FAMILIES = [
	{ id: 'balcony-grid', across: 20.5, deep: 20.5, floors: 2, accepts: luxury },
	{ id: 'corporate-sectors', across: 35, deep: 35, floors: 12, accepts: corporate },
	{ id: 'faceted-bays', across: 16.5, deep: 16.5, floors: 2, accepts: luxury },
	// A landmark design: it fronts its longer axis whichever way the plate is
	// turned, and tapers, so that front grows with the height it rises.
	{ id: 'garden-taper', across: 35, deep: 25, floors: 3, taper: 0.9, longFront: true, fixedFaces: false, landmark: true, accepts: always },
	// Its own minimum is 12 m, but the plate the 2 m forecourt leaves on a two-bay
	// lot carries no vertical core (measured: E_CORE_PLATE, compact_depth), so it
	// takes three bays like the rest.
	{ id: 'mirror-frame', across: 20, deep: 20, floors: 2, accepts: luxury },
	// A 24 by 14 m shell with 2.5 m of clearance on each free face.
	{ id: 'mirror-shutters', across: 29, deep: 19, floors: 2, accepts: luxury },
	{ id: 'white-grid', across: 17.5, deep: 17.5, floors: 4, accepts: luxury }
];

/** The luxury families stand on rich and high rich streets. */
function luxury( { tier } ) {

	return LUXURY.has( tier );

}

/** Corporate sectors is a big rich lot's corporate building or its top tower. */
function corporate( { type, tier } ) {

	return LUXURY.has( tier ) && ( type === 'corpo' || tier === 'high_rich' );

}

/** The landmark design takes the unique building whatever street it stands on. */
function always() {

	return true;

}

/**
 * The families a kit lot may wear, sorted. Landmark designs are not among them:
 * a shared building is a repeated one.
 * @param bays `{ across, deep }` of the lot as the building sees it: across its
 * entrance face and deep from it
 * @param floors the floor count the parcel is going to stand
 * @param use `{ type, tier }` from the Atlas parcel
 */
export function fittingFamilies( bays, floors, use ) {

	return fitting( bays.across * BAY, bays.deep * BAY, floors, use )
		.filter( ( family ) => ! family.landmark ).map( ( family ) => family.id );

}

/**
 * The families one unique building may wear, sorted, landmark designs included.
 * @param sides `{ across, deep }` of its footprint rectangle in metres, along
 * the axes Exterior fits the plate on
 * @param fixedFaces whether a connection cut above ground pins its faces, which
 * the landmark design does not take
 */
export function landmarkFamilies( sides, floors, use, { fixedFaces = false } = {} ) {

	return fitting( sides.across, sides.deep, floors, use )
		.filter( ( family ) => ! fixedFaces || family.fixedFaces !== false ).map( ( family ) => family.id );

}

/**
 * How tall a building standing on these parcels may be: at least every
 * envelope's minimum and at most every envelope's maximum, in whole storeys of
 * the shared pitch. Envelopes that contradict each other have no count they all
 * allow, so the band is the count the most of them accept and says so with
 * `fits: false`, which is what keeps a merge off a pair of lots no one building
 * suits; every lot still stands the nearest count its own envelope allows, so a
 * building is never taller than the lot it covers.
 * @returns `{ low, high, fits }`; a high under two floors is a lot no shared
 * building fits at all.
 */
export function floorRange( parcels ) {

	let low = MIN_FLOORS;
	let high = Infinity;

	for ( const { envelope } of parcels ) {

		const cap = Math.min( envelope.maxFloors, Math.floor( envelope.maxHeight / PITCH ) );

		low = Math.max( low, Math.min( envelope.minFloors, cap ) );
		high = Math.min( high, cap );

	}

	if ( ! Number.isFinite( high ) ) return { low, high: low, fits: true };
	if ( high < MIN_FLOORS ) return { low: MIN_FLOORS, high, fits: false };
	if ( low <= high ) return { low, high, fits: true };

	const shared = popularFloors( parcels );

	return { low: shared, high: shared, fits: false };

}

/**
 * The count the most of these envelopes allow, the lowest of them when several
 * tie. It is what a template slot whose lots want opposite heights stands: the
 * height most of its lots take, with the rest at the nearest count of their own.
 */
function popularFloors( parcels ) {

	const accepted = new Map();

	for ( const parcel of parcels ) {

		const { low, high } = floorRange( [ parcel ] );

		for ( let floors = low; floors <= high; floors ++ ) accepted.set( floors, ( accepted.get( floors ) ?? 0 ) + 1 );

	}

	let shared = MIN_FLOORS;
	let most = 0;

	for ( const [ floors, count ] of accepted ) {

		if ( count > most || ( count === most && floors < shared ) ) {

			shared = floors;
			most = count;

		}

	}

	return shared;

}

/** Every family whose published dimensions, height and use this building meets. */
function fitting( across, deep, floors, use ) {

	return FAMILIES.filter( ( family ) => clears( family, across, deep, floors )
		&& floors >= family.floors && family.accepts( use ) );

}

/** Whether a plate this wide across its front and this deep holds the family. */
function clears( family, across, deep, floors ) {

	const [ front, side ] = family.longFront
		? [ Math.max( across, deep ), Math.min( across, deep ) ] : [ across, deep ];

	return front >= family.across + ( family.taper ?? 0 ) * floors * PITCH && side >= family.deep;

}
