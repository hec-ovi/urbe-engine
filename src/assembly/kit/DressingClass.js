/**
 * What a shared building is dressed for.
 *
 * A plan used to carry its parcel's own type and tier, which is twenty seven
 * programmes in a 1 km city and a plan for each of them. What a building
 * actually wears is its tier's materials and whether it is a home or a business:
 * the approved families fit a rectangle and a floor height and never read the
 * programme ([../../../../exterior/src/families/CONTRACT.md]), and the host's own
 * parts that differ between the two are balconies and clotheslines against an
 * open shopfront. So a hotel, a market and an office of one tier stand the same
 * building, and the word each parcel reads is lettered on it at draw time.
 */

/** A home. */
const HOME = 'residential';
/** Everything a passer-by can walk into: shops, offices, hotels, clinics. */
const TRADE = 'commercial';
/** The programme each class is drawn as, which Exterior takes verbatim. */
const DRAWN_AS = { [ HOME ]: 'residential', [ TRADE ]: 'commerce' };

/**
 * The class a parcel's building is drawn for.
 * @param use `{ type, tier }` from the Atlas parcel
 * @returns `{ programme, tier }`
 */
export function dressingClass( { type, tier } ) {

	return { programme: type === HOME ? HOME : TRADE, tier };

}

/** The Exterior building type one class is drawn as. */
export function drawnAs( programme ) {

	return DRAWN_AS[ programme ] ?? DRAWN_AS[ TRADE ];

}

/** Whether a class carries the sign field the city letters a word on. */
export function lettered( programme ) {

	return programme === TRADE;

}
