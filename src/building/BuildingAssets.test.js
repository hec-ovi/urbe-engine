import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingAssets } from './BuildingAssets.js';

describe( 'BuildingAssets', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'asks the build boundary for the selected parcel and output', async () => {

		const fetch = vi.fn().mockResolvedValue( response( 200, { parcel: 'p136', out: '/out/urbe', built: true } ) );
		vi.stubGlobal( 'fetch', fetch );

		await expect( new BuildingAssets( 'p136', '/out/urbe' ).ensure() ).resolves.toMatchObject( { parcel: 'p136', built: true } );
		expect( fetch ).toHaveBeenCalledWith( '/api/building', expect.objectContaining( {
			method: 'POST', body: JSON.stringify( { parcel: 'p136', out: '/out/urbe' } )
		} ) );

	} );

	it( 'names a build-boundary failure for the visible viewer error', async () => {

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 404, { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } ) ) );

		await expect( new BuildingAssets( 'p9', '/out/missing' ).ensure() )
			.rejects.toThrow( 'E_WORLD_NOT_FOUND: missing has no Atlas sample' );

	} );

} );

function response( status, body ) {

	return { ok: status >= 200 && status < 300, status, json: async () => body };

}
