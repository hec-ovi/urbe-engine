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

/**
 * The use one shared building is drawn for: the class the most of the lots
 * standing on it carry, the first of them when several tie. A slot of a block
 * template is one building, so its lots of another tier stand that one rather
 * than each asking for a building of its own.
 * @param uses `{ type, tier }` of every parcel standing on the building
 * @returns one of those uses, or null when there are none
 */
export function sharedUse( uses ) {

	const counted = new Map();

	for ( const use of uses ) {

		const { programme, tier } = dressingClass( use );
		const held = counted.get( `${programme}-${tier}` );

		if ( held ) held.count ++;
		else counted.set( `${programme}-${tier}`, { use, count: 1 } );

	}

	let commonest = null;

	for ( const entry of counted.values() ) if ( ! commonest || entry.count > commonest.count ) commonest = entry;

	return commonest?.use ?? null;

}
