import { describe, expect, it, vi } from 'vitest';
import { HttpLauncherApi } from './HttpLauncherApi.js';

describe( 'HttpLauncherApi', () => {

	it( 'invokes a browser fetch function with its required global receiver', async () => {

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

	} );

	it( 'surfaces the server message for a rejected operation', async () => {

		const fetcher = () => Promise.resolve( new Response( JSON.stringify( { message: 'city is incomplete' } ), {
			status: 409, headers: { 'Content-Type': 'application/json' }
		} ) );

		await expect( new HttpLauncherApi( fetcher ).createGame( {} ) ).rejects.toThrow( 'city is incomplete' );

	} );

} );
