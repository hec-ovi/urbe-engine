import { describe, expect, it } from 'vitest';
import { PcmStreamDecoder } from './PcmStreamDecoder.js';
import { wav } from './voice.test-fixtures.js';

const SAMPLES = [ 0, 16384, - 32768, 32767, - 1, 3 ];
const FLOATS = SAMPLES.map( ( sample ) => sample / 32768 );

function decode( pieces ) {

	const decoder = new PcmStreamDecoder();
	return pieces.flatMap( ( piece ) => [ ...decoder.push( piece ) ] );

}

describe( 'PcmStreamDecoder', () => {

	it( 'gives the same samples however the stream is cut, the header and single samples included', () => {

		const bytes = wav( SAMPLES );
		for ( let first = 0; first <= bytes.length; first ++ ) {

			for ( const second of [ first, Math.min( bytes.length, first + 1 ), Math.min( bytes.length, first + 3 ) ] ) {

				expect( decode( [ bytes.subarray( 0, first ), bytes.subarray( first, second ), bytes.subarray( second ) ] ) ).toEqual( FLOATS );

			}

		}

	} );

	it( 'reads chunks before the data and stops a whole file at its data size', () => {

		const plain = wav( SAMPLES, { streamed: false } );
		const extra = new Uint8Array( [ ...'LIST' ].map( ( char ) => char.charCodeAt( 0 ) ).concat( [ 3, 0, 0, 0, 9, 9, 9, 0 ] ) );
		const bytes = new Uint8Array( [ ...plain.subarray( 0, 36 ), ...extra, ...plain.subarray( 36 ), 7, 7, 7, 7 ] );
		expect( decode( [ bytes.subarray( 0, 40 ), bytes.subarray( 40, 51 ), bytes.subarray( 51 ) ] ) ).toEqual( FLOATS );

	} );

	it( 'refuses audio that is not mono PCM16 at 24 kHz', () => {

		const stereo = wav( SAMPLES );
		new DataView( stereo.buffer ).setUint16( 22, 2, true );
		expect( () => decode( [ stereo ] ) ).toThrow( /not mono PCM16 at 24000 Hz/ );
		expect( () => decode( [ new TextEncoder().encode( '{"code":"E_UPSTREAM"}' ) ] ) ).toThrow( /not a WAV file/ );

	} );

} );
