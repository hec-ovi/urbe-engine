/**
 * Which look of a material a building wears. A material key can carry several
 * pattern variants drawn on the same module grid; every building picks one by
 * its parcel id, so a street mixes them and a rebuild keeps each building's.
 * Photographed variants are left out: only pattern variants sit on the grid.
 */
export function variantFor( entry, parcelId, limit = Infinity ) {

	if ( ! entry?.variants?.length ) return null;

	const candidates = entry.variants.filter( ( v ) => v.class === 'pattern' );
	const pool = ( candidates.length ? candidates : entry.variants ).slice( 0, limit );
	if ( pool.length < 2 ) return pool[ 0 ]?.id ?? null;

	return pool[ hash( parcelId ) % pool.length ].id;

}

const DOUBLE_SIDED = '|side=double';

/** The bucket a building's geometry merges into: key, variant and authored face behavior. */
export function bucketFor( key, variantId, doubleSided = false ) {

	return `${variantId ? `${key}#${variantId}` : key}${doubleSided ? DOUBLE_SIDED : ''}`;

}

/** A merge bucket back into what the factory takes. */
export function splitBucket( bucket ) {

	const doubleSided = bucket.endsWith( DOUBLE_SIDED );
	const material = doubleSided ? bucket.slice( 0, - DOUBLE_SIDED.length ) : bucket;
	const split = material.indexOf( '#' );
	const key = split < 0 ? material : material.slice( 0, split );
	const variantId = split < 0 ? undefined : material.slice( split + 1 );

	return { key, variantId, ...( doubleSided ? { doubleSided } : {} ) };

}

function hash( text ) {

	let h = 2166136261;
	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );
	return h >>> 0;

}
