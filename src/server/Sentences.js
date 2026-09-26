/** Where a sentence ends: its closing punctuation and quotes before whitespace, or a line break. */
const END = /[.!?…]+["'”’)\]]*(?=\s)|\n/g;
const WORD = /[\p{L}\p{N}]/u;

/**
 * Cuts streamed text into whole sentences as they complete, so a voice can
 * start on the first one while the rest is still arriving. Pieces may split
 * anywhere; the sentences are the same as for the whole text at once.
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
