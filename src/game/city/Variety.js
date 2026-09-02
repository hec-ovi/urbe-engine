/**
 * Which look of a material a building wears. A material key can carry several
 * pattern variants drawn on the same module grid; every building picks one by
 * its parcel id, so a street mixes them and a rebuild keeps each building's.
 * Photographed variants are left out: only pattern variants sit on the grid.
 */
export function variantFor( entry, parcelId ) {

	if ( ! entry?.variants?.length ) return null;

	const candidates = entry.variants.filter( ( v ) => v.class === 'pattern' );
	const pool = candidates.length ? candidates : entry.variants;
	if ( pool.length < 2 ) return pool[ 0 ]?.id ?? null;

	return pool[ hash( parcelId ) % pool.length ].id;

}

/** The bucket a building's geometry merges into: the key with the variant it wears. */
export function bucketFor( key, variantId ) {

	return variantId ? `${key}#${variantId}` : key;

}

/** A merge bucket back into what the factory takes. */
export function splitBucket( bucket ) {

	const [ key, variantId ] = bucket.split( '#' );
	return { key, variantId };

}

function hash( text ) {

	let h = 2166136261;
	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );
	return h >>> 0;

}
