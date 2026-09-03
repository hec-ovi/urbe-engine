import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingAssets } from './BuildingAssets.js';

describe( 'BuildingAssets', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'asks the build boundary for the selected parcel and output', async () => {

		const fetch = vi.fn().mockResolvedValue( response( 200, { parcel: 'p136', out: '/out/urbe', built: true } ) );
		vi.stubGlobal( 'fetch', fetch );

		await expect( new BuildingAssets( 'p136', '/out/urbe' ).ensure( 'interior' ) ).resolves.toMatchObject( { parcel: 'p136', built: true } );
		expect( fetch ).toHaveBeenCalledWith( '/api/building', expect.objectContaining( {
			method: 'POST', body: JSON.stringify( { parcel: 'p136', out: '/out/urbe', source: 'interior' } )
		} ) );

	} );

	it( 'names a build-boundary failure for the visible viewer error', async () => {

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 404, { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } ) ) );

		await expect( new BuildingAssets( 'p9', '/out/missing' ).ensure() )
			.rejects.toMatchObject( { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } );

	} );

	it( 'recognizes Vite HTML fallback as unavailable output, not a GLB', async () => {

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 200, '<!doctype html>', 'text/html' ) ) );
		const status = await new BuildingAssets( 'p113', '/out/urbe' ).inspectScene( 'interior' );

		expect( status ).toMatchObject( {
			available: false,
			state: 'unavailable',
			code: 'E_SOURCE_UNAVAILABLE',
			mediaType: 'text/html'
		} );

	} );

	it( 'distinguishes a malformed successful response from missing output', async () => {

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 200, 'not a glb', 'text/plain' ) ) );
		const status = await new BuildingAssets( 'p2', '/out/small' ).inspectScene( 'interior' );

		expect( status ).toMatchObject( { available: false, state: 'failed', code: 'E_SOURCE_RESPONSE' } );

	} );

} );

function response( status, body, type = 'application/json' ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: ( name ) => name === 'content-type' ? type : null },
		json: async () => body
	};

}
