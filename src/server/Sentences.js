/** Where a sentence may end: its closing punctuation and quotes before whitespace, or a line break. */
const END = /[.!?…]+["'”’)\]]*(?=\s)|\n/g;
const WORD = /[\p{L}\p{N}]/u;
/** A title or name part a period follows inside a sentence: "Mr. Okafor", "St. Anne", "Det. Ruiz". */
const ABBREVIATION = /(?:^|[^\p{L}])(?:mr|mrs|ms|dr|st|jr|sr|mt|prof|det|sgt|capt|lt|insp|vs)\.$/iu;
/** The first character after a sentence end, once it has arrived. */
const NEXT = /\s*(\S)/y;
/** A lowercase letter or a digit goes on with the sentence a lone period seemed to end: "e.g. the", "No. 5". */
const GOES_ON = /[\p{Ll}\p{N}]/u;

/**
 * Cuts streamed text into whole sentences as they complete, so a voice can
 * start on the first one while the rest is still arriving. Pieces may split
 * anywhere; the sentences are the same as for the whole text at once. A lone
 * period ends no sentence after a title or name abbreviation, or before a
 * lowercase letter or a digit, so each sentence reaches the voice whole.
 */
export class Sentences {

	#text = '';

	/** @returns the sentences this piece completes, trimmed */
	push( text ) {

		this.#text += text;
		const sentences = [];
		let from = 0;
		for ( const end of this.#text.matchAll( END ) ) {

			const to = end.index + end[ 0 ].length;
			const sentence = this.#text.slice( from, to ).trim();
			// Punctuation alone ("...") stays with the sentence it opens.
			if ( ! WORD.test( sentence ) ) continue;
			if ( end[ 0 ].replace( /["'”’)\]]+$/, '' ) === '.' ) {

				if ( ABBREVIATION.test( sentence ) ) continue;
				NEXT.lastIndex = to;
				const next = NEXT.exec( this.#text );
				// What follows decides, so the sentence waits for it.
				if ( ! next ) break;
				if ( GOES_ON.test( next[ 1 ] ) ) continue;

			}
			sentences.push( sentence );
			from = to;

		}
		this.#text = this.#text.slice( from );
		return sentences;

	}

	/** @returns what is left once the text is complete, as its last sentence */
	end() {

		const rest = this.#text.trim();
		this.#text = '';
		return rest ? [ rest ] : [];

	}

}
