import { describe, expect, it } from 'vitest';
import { VoiceCache } from './VoiceCache.js';

const kept = ( cache, keys ) => keys.map( ( key ) => cache.has( key ) );

describe( 'VoiceCache', () => {

	it( 'keeps lines under its byte and entry caps, dropping the least recently used first', () => {

		const cache = new VoiceCache( { maxBytes: 40, maxEntries: 3 } );
		cache.set( 'a', new Float32Array( 4 ) );
		cache.set( 'b', new Float32Array( 4 ) );
		expect( cache.get( 'a' ) ).toHaveLength( 4 );
		cache.set( 'c', new Float32Array( 3 ) );
		expect( kept( cache, [ 'a', 'b', 'c' ] ) ).toEqual( [ true, false, true ] );

		cache.set( 'd', new Float32Array( 1 ) );
		cache.set( 'e', new Float32Array( 1 ) );
		expect( kept( cache, [ 'a', 'c', 'd', 'e' ] ) ).toEqual( [ false, true, true, true ] );
		cache.set( 'huge', new Float32Array( 11 ) );
		expect( cache.has( 'huge' ) ).toBe( false );
		expect( cache.get( 'huge' ) ).toBeNull();

	} );

	it( 'frees what a replaced line held', () => {

		const cache = new VoiceCache( { maxBytes: 40 } );
		cache.set( 'a', new Float32Array( 8 ) );
		cache.set( 'a', new Float32Array( 2 ) );
		cache.set( 'b', new Float32Array( 8 ) );
		expect( kept( cache, [ 'a', 'b' ] ) ).toEqual( [ true, true ] );
		expect( cache.get( 'a' ) ).toHaveLength( 2 );

	} );

} );
