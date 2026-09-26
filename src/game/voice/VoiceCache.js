/** A Float32 sample is four bytes. */
const BYTES_PER_SAMPLE = 4;

/**
 * The lines this session has heard whole, as decoded samples, least recently
 * used first out. Bounded by bytes and by entries; a line bigger than the
 * byte cap is not kept.
 */
export class VoiceCache {

	#lines = new Map();
	#bytes = 0;

	constructor( { maxBytes = 48 * 1024 * 1024, maxEntries = 64 } = {} ) {

		this.maxBytes = maxBytes;
		this.maxEntries = maxEntries;

	}

	has( key ) {

		return this.#lines.has( key );

	}

	/** The samples, now the most recently used, or null. */
	get( key ) {

		const samples = this.#lines.get( key );
		if ( ! samples ) return null;
		this.#lines.delete( key );
		this.#lines.set( key, samples );
		return samples;

	}

	set( key, samples ) {

		this.#drop( key );
		const bytes = samples.length * BYTES_PER_SAMPLE;
		if ( bytes > this.maxBytes ) return;
		this.#lines.set( key, samples );
		this.#bytes += bytes;
		for ( const [ oldest ] of this.#lines ) {

			if ( this.#bytes <= this.maxBytes && this.#lines.size <= this.maxEntries ) break;
			this.#drop( oldest );

		}

	}

	#drop( key ) {

		const samples = this.#lines.get( key );
		if ( ! samples ) return;
		this.#lines.delete( key );
		this.#bytes -= samples.length * BYTES_PER_SAMPLE;

	}

}
