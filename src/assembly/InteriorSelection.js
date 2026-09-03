import { fnv1a } from './hash.js';

/** Building types that can host a quest interaction without inventing a venue. */
export const QUEST_CAPABLE_TYPES = new Set( [
	'commerce', 'mall', 'restaurant', 'coffee_shop', 'hotel', 'clinic', 'hospital', 'police'
] );

/**
 * All interior candidates in deterministic priority order. Parcels referenced
 * by carried questlines come first, then other venue parcels. Array order in
 * either input has no effect.
 */
export function interiorCandidates( atlas, questlines = [], available = null ) {

	const known = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
	const allowed = available ? new Set( available ) : new Set( known.keys() );
	const referenced = questParcelIds( questlines ).filter( ( id ) => known.has( id ) && allowed.has( id ) );
	const referenceSet = new Set( referenced );
	const venues = atlas.parcels
		.filter( ( parcel ) => allowed.has( parcel.id ) && QUEST_CAPABLE_TYPES.has( parcel.type ) && ! referenceSet.has( parcel.id ) )
		.map( ( parcel ) => parcel.id );
	const rank = ( ids, group ) => [ ...new Set( ids ) ].sort(
		( a, b ) => fnv1a( `${atlas.meta.seed}:interior:${group}:${a}` )
			- fnv1a( `${atlas.meta.seed}:interior:${group}:${b}` ) || a.localeCompare( b )
	);

	return [ ...rank( referenced, 'quest' ), ...rank( venues, 'venue' ) ];

}

/** The first requested candidate ids, mostly useful to callers that need no retry. */
export function selectInteriors( atlas, questlines = [], count = 5, available = null ) {

	return interiorCandidates( atlas, questlines, available ).slice( 0, Math.max( 0, count ) );

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
