import { vi } from 'vitest';
import { SAMPLE_RATE } from './PcmStreamDecoder.js';

/** Voice's WAV for `samples` (Int16 values): a streamed line's unknown sizes, or a whole file's own. */
export function wav( samples, { streamed = true } = {} ) {

	const bytes = new Uint8Array( 44 + samples.length * 2 );
	const view = new DataView( bytes.buffer );
	const tag = ( at, text ) => [ ...text ].forEach( ( char, i ) => view.setUint8( at + i, char.charCodeAt( 0 ) ) );
	const size = ( value ) => streamed ? 0xffffffff : value;
	tag( 0, 'RIFF' ); view.setUint32( 4, size( 36 + samples.length * 2 ), true ); tag( 8, 'WAVE' );
	tag( 12, 'fmt ' ); view.setUint32( 16, 16, true ); view.setUint16( 20, 1, true ); view.setUint16( 22, 1, true );
	view.setUint32( 24, SAMPLE_RATE, true ); view.setUint32( 28, SAMPLE_RATE * 2, true ); view.setUint16( 32, 2, true ); view.setUint16( 34, 16, true );
	tag( 36, 'data' ); view.setUint32( 40, size( samples.length * 2 ), true );
	samples.forEach( ( sample, i ) => view.setInt16( 44 + i * 2, sample, true ) );
	return bytes;

}

/** `seconds` of audio as Float32 samples. */
export function audio( seconds, value = 0.25 ) {

	return new Float32Array( Math.round( seconds * SAMPLE_RATE ) ).fill( value );

}

/** A Web Audio context on a clock the test moves; `sources` are every buffer source made, in order. */
export class FakeAudioContext {

	constructor() {

		this.currentTime = 0;
		this.state = 'running';
		this.destination = {};
		this.sources = [];
		this.gains = [];

	}

	createGain() {

		const gain = { gain: { value: 1 }, connect: vi.fn() };
		this.gains.push( gain );
		return gain;

	}

	createBuffer( _channels, length, rate ) {

		return { length, duration: length / rate, copyToChannel: vi.fn() };

	}

	createBufferSource() {

		const source = { connect: vi.fn(), disconnect: vi.fn(), stop: vi.fn(), onended: null, start: vi.fn( ( at ) => source.at = at ) };
		this.sources.push( source );
		return source;

	}

	resume() {

		this.state = 'running';
		return Promise.resolve();

	}

	suspend() {

		this.state = 'suspended';
		return Promise.resolve();

	}

	/** Moves the clock and ends every source whose audio has played by then. */
	advance( seconds ) {

		this.currentTime += seconds;
		for ( const source of this.sources ) {

			if ( source.ended || source.at === undefined || source.at + source.buffer.duration > this.currentTime ) continue;
			source.ended = true;
			source.onended?.();

		}

	}

}
