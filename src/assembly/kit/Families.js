/**
 * Which approved Exterior family a lot may wear.
 *
 * The user approved six facade families at full detail, each with a shape that
 * needs room and height to read: corporate-sectors wants a broad corporate
 * plate, the other five want a luxury street. A lot that fits none of them gets
 * Exterior's ordinary output, which is a building in its own right and not a
 * fallback. Garden taper stays a landmark design and is never chosen here.
 *
 * The minima are the published family dimensions rounded up to whole 8 m bays,
 * so a lot that passes here is a lot the generator can actually fit.
 */

/** The bay every Atlas lot edge is a whole number of. */
export const BAY = 8;
/** A shared building starts at a ground and a crown, so two floors. */
export const MIN_FLOORS = 2;
/** The streets the five luxury families stand on. */
const LUXURY = new Set( [ 'rich', 'high_rich' ] );

const FAMILIES = [
	{ id: 'balcony-grid', short: 24, long: 24, floors: 3, accepts: luxury },
	{ id: 'corporate-sectors', short: 40, long: 40, floors: 12, accepts: corporate },
	{ id: 'faceted-bays', short: 24, long: 24, floors: 3, accepts: luxury },
	{ id: 'mirror-frame', short: 24, long: 24, floors: 3, accepts: luxury },
	{ id: 'mirror-shutters', short: 32, long: 32, floors: 3, accepts: luxury },
	{ id: 'white-grid', short: 24, long: 24, floors: 4, accepts: luxury }
];

/** The five luxury families stand on rich and high rich streets. */
function luxury( { tier } ) {

	return LUXURY.has( tier );

}

/** Corporate sectors is a corporate building, or the top tier's own tower. */
function corporate( { type, tier } ) {

	return type === 'corpo' || tier === 'high_rich';

}

/**
 * The families this lot may wear, sorted.
 * @param bays `{ across, deep }` of the lot
 * @param floors the floor count the parcel is going to stand
 * @param use `{ type, tier }` from the Atlas parcel
 */
export function fittingFamilies( bays, floors, use ) {

	const short = Math.min( bays.across, bays.deep ) * BAY;
	const long = Math.max( bays.across, bays.deep ) * BAY;

	return FAMILIES
		.filter( ( family ) => short >= family.short && long >= family.long
			&& floors >= family.floors && family.accepts( use ) )
		.map( ( family ) => family.id );

}
