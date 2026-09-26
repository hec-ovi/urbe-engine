import { fnv1a } from './hash.js';

/** Building types that can host a quest interaction without inventing a venue. */
export const QUEST_CAPABLE_TYPES = new Set( [
	'commerce', 'mall', 'restaurant', 'coffee_shop', 'hotel', 'clinic', 'hospital', 'police'
] );

/**
 * All interior candidates in deterministic priority order: the caller's
 * priority parcels in its order, then parcels referenced by carried
 * questlines in the order the questlines name them, then other venue parcels
 * by a stable hash.
 */
export function interiorCandidates( atlas, questlines = [], available = null, priority = [] ) {

	const known = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
	const allowed = available ? new Set( available ) : new Set( known.keys() );
	const usable = ( id ) => known.has( id ) && allowed.has( id );
	// Quest locations keep the story's own order (the main line first), so a
	// count that only covers the main line opens exactly its places.
	const first = [ ...new Set( [ ...priority.filter( usable ), ...questParcelIds( questlines ).filter( usable ) ] ) ];
	const ranked = new Set( first );
	const venues = atlas.parcels
		.filter( ( parcel ) => allowed.has( parcel.id ) && QUEST_CAPABLE_TYPES.has( parcel.type ) && ! ranked.has( parcel.id ) )
		.map( ( parcel ) => parcel.id )
		.sort( ( a, b ) => fnv1a( `${atlas.meta.seed}:interior:venue:${a}` )
			- fnv1a( `${atlas.meta.seed}:interior:venue:${b}` ) || a.localeCompare( b ) );

	return [ ...first, ...venues ];

}

/** Every explicit parcel reference anywhere in a quest definition. */
export function questParcelIds( value ) {

	const ids = new Set();
	visit( value, ids );

	return [ ...ids ];

}

function visit( value, ids ) {

	if ( Array.isArray( value ) ) {

		for ( const entry of value ) visit( entry, ids );
		return;

	}
	if ( ! value || typeof value !== 'object' ) return;

	for ( const [ key, entry ] of Object.entries( value ) ) {

		if ( ( key === 'parcelId' || key === 'atParcelId' ) && typeof entry === 'string' ) ids.add( entry );
		else visit( entry, ids );

	}

}
