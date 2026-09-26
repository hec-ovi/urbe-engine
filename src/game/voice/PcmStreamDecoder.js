/** The only audio Voice sends: WAV, PCM16 little-endian, mono, 24 kHz. */
export const SAMPLE_RATE = 24000;
/** A streamed line's RIFF and data sizes: the length is not known yet. */
const UNKNOWN_SIZE = 0xffffffff;

/**
 * Turns a WAV byte stream into Float32 samples as the bytes arrive, however
 * the stream is cut: the header is read across pieces and a sample split
 * between two pieces waits for its second byte. A streamed line's data runs
 * to the end of the stream; a whole file's stops at its data size.
 */
export class PcmStreamDecoder {

	#head = new Uint8Array( 0 );
	/** Data bytes still expected, Infinity until the end of a streamed line; null before the header. */
	#left = null;
	#odd = null;

	/** The samples this piece completes, possibly none. Throws on a WAV that is not Voice's format. */
	push( bytes ) {

		if ( this.#left === null ) {

			bytes = this.#header( concat( this.#head, bytes ) );
			if ( ! bytes ) return new Float32Array( 0 );

		}
		const length = Math.min( bytes.length, this.#left );
		this.#left -= length;
		let data = bytes.subarray( 0, length );
		if ( this.#odd !== null ) data = concat( Uint8Array.of( this.#odd ), data );
		const whole = data.length - ( data.length % 2 );
		this.#odd = whole < data.length ? data[ whole ] : null;
		const view = new DataView( data.buffer, data.byteOffset, whole );
		const samples = new Float32Array( whole / 2 );
		for ( let i = 0; i < samples.length; i ++ ) samples[ i ] = view.getInt16( i * 2, true ) / 32768;
		return samples;

	}

	/** The bytes after the data chunk's header, or null while the header is incomplete. */
	#header( bytes ) {

		const view = new DataView( bytes.buffer, bytes.byteOffset, bytes.length );
		const tag = ( at ) => String.fromCharCode( ...bytes.subarray( at, at + 4 ) );
		if ( bytes.length >= 12 && ( tag( 0 ) !== 'RIFF' || tag( 8 ) !== 'WAVE' ) ) throw new Error( 'voice audio is not a WAV file' );
		let at = 12;
		let format = false;
		while ( at + 8 <= bytes.length ) {

			const size = view.getUint32( at + 4, true );
			if ( tag( at ) === 'data' ) {

				if ( ! format ) throw new Error( 'voice audio has no format before its data' );
				this.#left = size === UNKNOWN_SIZE ? Infinity : size;
				return bytes.subarray( at + 8 );

			}
			if ( at + 8 + size > bytes.length ) break;
			if ( tag( at ) === 'fmt ' ) {

				const [ encoding, channels, rate, bits ] = [ view.getUint16( at + 8, true ), view.getUint16( at + 10, true ),
					view.getUint32( at + 12, true ), view.getUint16( at + 22, true ) ];
				if ( encoding !== 1 || channels !== 1 || rate !== SAMPLE_RATE || bits !== 16 ) {

					throw new Error( `voice audio is ${channels} channel ${bits} bit ${rate} Hz format ${encoding}, not mono PCM16 at ${SAMPLE_RATE} Hz` );

				}
				format = true;

			}
			at += 8 + size + ( size % 2 );

		}
		this.#head = bytes;
		return null;

	}

}

function concat( first, second ) {

	if ( ! first.length ) return second;
	const joined = new Uint8Array( first.length + second.length );
	joined.set( first );
	joined.set( second, first.length );
	return joined;

}
