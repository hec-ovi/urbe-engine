import prices from './prices.json' with { type: 'json' };

/**
 * What things cost in credits ([prices.json](prices.json)): each good's base
 * price, scaled by the tier of the place that sells it unless the Bureau fixes
 * it; the menus each kind of venue sells from; the fares; and the wage.
 */

/** How a place's wealth tier scales a price: a rich bar asks half as much again. */
export const TIER_RATE = Object.freeze( { ...prices.tierRates } );
/** Every good by id: `{ id, name, base, fixed?, sort, menus }`. */
export const GOODS = new Map( prices.goods.map( ( good ) => [ good.id, Object.freeze( { ...good } ) ] ) );
/** A ride on a bus or a tram, and travel between stations: the same anywhere. */
export const FARES = Object.freeze( { ...prices.fares } );
/** The player's weekly pay, the Bureau's file fee on it, a story shift's pay and what a new game starts with. */
export const WAGE = Object.freeze( { ...prices.wage } );

/** A good's price at a place of `tier`: its fixed price, else its base scaled and rounded, at least 1; null for no such good. */
export function priceOf( goodId, tier = 'mid' ) {

	const good = GOODS.get( goodId );
	if ( ! good ) return null;
	if ( good.fixed ) return good.base;
	return Math.max( 1, Math.round( good.base * ( TIER_RATE[ tier ] ?? 1 ) ) );

}

/** Whether a kind of venue sells anything. */
export function hasMenu( venueType ) {

	return prices.goods.some( ( good ) => good.menus.includes( venueType ) );

}

/** What a venue of this kind and tier sells: `[{ goodId, name, price }]` in the list's order. */
export function menuOf( venueType, tier = 'mid' ) {

	return prices.goods.filter( ( good ) => good.menus.includes( venueType ) )
		.map( ( good ) => ( { goodId: good.id, name: good.name, price: priceOf( good.id, tier ) } ) );

}

/**
 * The good a thing's name is: a good of exactly that name, else the good
 * whose last word the name holds as a word (`amber whisky` is whisky,
 * `ration drink` is the ration drink); null for none.
 */
export function goodOfItem( name ) {

	const text = String( name ?? '' ).trim().toLowerCase();
	if ( ! text ) return null;
	const exact = prices.goods.find( ( good ) => good.name.toLowerCase() === text );
	if ( exact ) return exact.id;
	const words = new Set( text.split( /[^a-z]+/ ).filter( Boolean ) );
	const named = prices.goods.find( ( good ) => words.has( good.name.toLowerCase().split( /\s+/ ).at( - 1 ) ) );
	return named?.id ?? null;

}
