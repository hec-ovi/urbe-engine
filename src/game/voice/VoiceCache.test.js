import { describe, expect, it } from 'vitest';
import { VoiceCache } from './VoiceCache.js';

describe( 'VoiceCache', () => {

	it( 'keeps lines under its byte and entry caps, dropping the least recently used first', () => {

		const cache = new VoiceCache( { maxBytes: 40, maxEntries: 3 } );
		cache.set( 'a', new Float32Array( 4 ) );
		cache.set( 'b', new Float32Array( 4 ) );
		expect( cache.get( 'a' ) ).toHaveLength( 4 );
		cache.set( 'c', new Float32Array( 3 ) );
		expect( [ cache.has( 'a' ), cache.has( 'b' ), cache.has( 'c' ) ] ).toEqual( [ true, false, true ] );
		expect( cache.bytes ).toBe( 28 );

		cache.set( 'd', new Float32Array( 1 ) );
		cache.set( 'e', new Float32Array( 1 ) );
		expect( [ ...[ 'a', 'c', 'd', 'e' ].map( ( key ) => cache.has( key ) ) ] ).toEqual( [ false, true, true, true ] );
		expect( cache.size ).toBe( 3 );

		expect( cache.bytes ).toBe( 20 );
		cache.set( 'huge', new Float32Array( 11 ) );
		expect( cache.has( 'huge' ) ).toBe( false );
		cache.set( 'c', new Float32Array( 1 ) );
		expect( cache.bytes ).toBe( 12 );
		cache.clear();
		expect( [ cache.size, cache.bytes, cache.get( 'c' ) ] ).toEqual( [ 0, 0, null ] );

	} );

} );
