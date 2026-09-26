/**
 * What each storey of a furnished building is for.
 *
 * A blueprint names each floor for what its shell was drawn as, and a shared kit
 * plan is drawn for a dressing class, never for the parcel standing on it: every
 * floor of a business plan reads `commerce` and every floor of a home reads
 * `residential`, whether a hotel, a clinic or a market stands there. So Interior
 * is told each floor's programme from the Atlas parcel's own use, in the
 * programme names its request schema accepts
 * (../../../interior/schemas/request.schema.json): the street floor is the venue
 * a passer-by walks into, or a lobby, and every floor above it holds what the
 * building is. A street venue takes the ground floor alone, with homes above it
 * on an ordinary street and offices on a rich one.
 */

/** The street floor, per Atlas type; every other type opens on a lobby. */
const GROUND = {
	coffee_shop: 'coffee_shop', restaurant: 'restaurant', commerce: 'retail', mall: 'mall_floor', factory: 'mechanical'
};

/** The floors above the street, per Atlas type. */
const ABOVE = {
	hotel: 'hotel_rooms', offices: 'office', corpo: 'corpo_office',
	// Interior publishes no ward, surgery or station programme yet.
	hospital: 'office', clinic: 'office', police: 'office', military: 'office',
	factory: 'mechanical', mall: 'mall_floor'
};

/** The streets whose venues have offices above them rather than homes. */
const RICH = new Set( [ 'rich', 'high_rich' ] );

/**
 * One assignment per blueprint floor, basements included.
 * @param parcel the Atlas parcel: `type` and `tier`
 * @param blueprint the building's blueprint, whichever path built it
 * @returns `[{ floor, kind }]` in the blueprint's floor order
 */
export function floorAssignments( { type, tier }, blueprint ) {

	const street = Math.min( ...blueprint.floors.filter( ( floor ) => floor.index >= 0 ).map( ( floor ) => floor.index ) );
	const above = upper( type, tier );

	return blueprint.floors.map( ( floor ) => ( {
		floor: floor.index,
		kind: floor.index < 0 ? 'parking'
			: floor.index === street ? GROUND[ type ] ?? 'lobby'
			// A tall hotel's shell may crown itself with a bar.
			: floor.kind === 'bar' ? 'restaurant' : above
	} ) );

}

/**
 * What stands above the street: the building's own programme, else homes, which
 * are studios on a poor street, or offices over a rich street's venue.
 */
function upper( type, tier ) {

	if ( ABOVE[ type ] ) return ABOVE[ type ];
	if ( type !== 'residential' && RICH.has( tier ) ) return 'office';

	return tier === 'poor' ? 'residence_studio' : 'apartment';

}
