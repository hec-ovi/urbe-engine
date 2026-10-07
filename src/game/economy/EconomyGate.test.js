import { describe, expect, it, vi } from 'vitest';
import { probe } from './EconomyGate.js';

const json = ( body, status = 200 ) => ( { ok: status >= 200 && status < 300, status, json: async () => body } );
const page = () => ( { ok: true, status: 200, json: async () => JSON.parse( '<!doctype html><html></html>' ) } );

describe( 'whether the servers take the economy', () => {

	it( 'opens both switches only when both servers say so', async () => {

		const fetcher = vi.fn( async ( url, options ) => {

			if ( url === '/api/launcher' ) {

				expect( JSON.parse( options.body ) ).toEqual( { method: 'abilities' } );
				return json( { saveFields: [ 'contacts', 'access', 'economy' ] } );

			}
			expect( url ).toBe( '/api/talk/abilities' );
			return json( { abilities: [ 'economy' ] } );

		} );
		expect( await probe( fetcher ) ).toEqual( { saves: true, talk: true } );
		expect( fetcher ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'counts the page fallback, a 400, a 404, bad JSON, an old answer and no answer as off', async () => {

		const each = async ( answer ) => probe( vi.fn( async () => answer() ) );
		expect( await each( page ) ).toEqual( { saves: false, talk: false } );
		expect( await each( () => json( { code: 'E_INVALID_REQUEST' }, 400 ) ) ).toEqual( { saves: false, talk: false } );
		expect( await each( () => json( {}, 404 ) ) ).toEqual( { saves: false, talk: false } );
		expect( await each( () => ( { ok: true, status: 200, json: async () => { throw new SyntaxError( 'bad' ); } } ) ) ).toEqual( { saves: false, talk: false } );
		expect( await each( () => json( { saveFields: [ 'contacts' ], abilities: [] } ) ) ).toEqual( { saves: false, talk: false } );
		expect( await probe( vi.fn( async () => { throw new TypeError( 'offline' ); } ) ) ).toEqual( { saves: false, talk: false } );
		expect( await probe( null ) ).toEqual( { saves: false, talk: false } );
		// One server new, the other old: only that switch opens.
		const half = vi.fn( async ( url ) => url === '/api/launcher' ? json( { saveFields: [ 'economy' ] } ) : json( {}, 404 ) );
		expect( await probe( half ) ).toEqual( { saves: true, talk: false } );

	} );

} );
