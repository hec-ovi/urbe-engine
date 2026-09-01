// The exterior letter atlas (../exterior/CONTRACT.md, signage): a character
// outside it reads as the trailing space, a blank cell.
const CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.,'!?:/&+ ";

/**
 * Marquee text from a parcel name: diacritics folded onto their base letter,
 * uppercased, every character still outside the atlas read as the space it
 * would reserve (runs collapsed), then whole words in order while they fit
 * the limit. Null when the name is empty or not even its first word fits.
 */
export function signText( name, limit ) {

	const letters = [ ...( name ?? '' ).normalize( 'NFD' ).replace( /\p{M}/gu, '' ).toUpperCase() ]
		.map( ( char ) => CHARSET.includes( char ) ? char : ' ' )
		.join( '' );

	let text = '';

	for ( const word of letters.split( ' ' ).filter( Boolean ) ) {

		const next = text ? `${text} ${word}` : word;

		if ( next.length > limit ) break;

		text = next;

	}

	return text || null;

}
