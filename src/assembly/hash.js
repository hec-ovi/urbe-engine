/**
 * Deterministic string hashing for seed-derived choices. Same input, same value, on every platform.
 */

/** FNV-1a 32-bit hash of a string. */
export function fnv1a( text ) {

	let h = 0x811c9dc5;

	for ( let i = 0; i < text.length; i ++ ) {

		h ^= text.charCodeAt( i );
		h = Math.imul( h, 0x01000193 ) >>> 0;

	}

	return h >>> 0;

}

/** Deterministic integer in [min, max] derived from a string. */
export function pickInt( text, min, max ) {

	if ( max <= min ) return min;

	return min + ( fnv1a( text ) % ( max - min + 1 ) );

}
