import { describe, expect, it, vi } from 'vitest';
import { HttpLauncherApi } from './HttpLauncherApi.js';

describe( 'HttpLauncherApi', () => {

	it( 'posts one method envelope with the global receiver a browser fetch needs, and surfaces a rejection message', async () => {

		const fetcher = vi.fn( function( url, options ) {

			expect( this ).toBe( globalThis );
			expect( url ).toBe( '/api/launcher' );
			expect( JSON.parse( options.body ) ).toEqual( { method: 'catalog' } );
			return Promise.resolve( new Response( JSON.stringify( { games: [], cities: [] } ), {
				status: 200, headers: { 'Content-Type': 'application/json' }
			} ) );

		} );
		await expect( new HttpLauncherApi( fetcher ).catalog() ).resolves.toEqual( { games: [], cities: [] } );
		expect( fetcher ).toHaveBeenCalledOnce();

		const refused = () => Promise.resolve( new Response( JSON.stringify( { message: 'city is incomplete' } ), {
			status: 409, headers: { 'Content-Type': 'application/json' }
		} ) );
		await expect( new HttpLauncherApi( refused ).createGame( {} ) ).rejects.toThrow( 'city is incomplete' );

	} );

} );
