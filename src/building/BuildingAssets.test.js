import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingAssets } from './BuildingAssets.js';

describe( 'BuildingAssets', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'asks the build boundary for the selected parcel, names its failures and checks the response media type', async () => {

		const fetch = vi.fn().mockResolvedValue( response( 200, { parcel: 'p136', out: '/out/urbe', built: true } ) );
		vi.stubGlobal( 'fetch', fetch );
		await expect( new BuildingAssets( 'p136', '/out/urbe' ).ensure( 'interior' ) ).resolves.toMatchObject( { parcel: 'p136', built: true } );
		expect( fetch ).toHaveBeenCalledWith( '/api/building', expect.objectContaining( {
			method: 'POST', body: JSON.stringify( { parcel: 'p136', out: '/out/urbe', source: 'interior' } )
		} ) );

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 404, { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } ) ) );
		await expect( new BuildingAssets( 'p9', '/out/missing' ).ensure() )
			.rejects.toMatchObject( { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } );

		// Vite answers an absent file with the index page, which is not a GLB.
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 200, '<!doctype html>', 'text/html' ) ) );
		await expect( new BuildingAssets( 'p113', '/out/urbe' ).inspectScene( 'interior' ) ).resolves.toMatchObject( {
			available: false, state: 'unavailable', code: 'E_SOURCE_UNAVAILABLE', mediaType: 'text/html'
		} );

		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 200, 'not a glb', 'text/plain' ) ) );
		await expect( new BuildingAssets( 'p2', '/out/small' ).inspectScene( 'interior' ) ).resolves.toMatchObject( {
			available: false, state: 'failed', code: 'E_SOURCE_RESPONSE'
		} );

	} );

	it( 'loads the paired placement layouts and their shared catalogs without requiring an interior GLB', async () => {
		const building = { floors: [ { index: 0 } ], layouts: { ground: 'layouts/ground.json' } };
		const docs = {
			'/out/previews/p1/interior/building.json': building,
			'/out/previews/p1/interior/layouts/ground.json': { id: 'ground', placements: [] },
			'/out/previews/p1/preview.json': { interiorModules: { shared: 'rooms/a', file: 'modules.json' }, interiorProps: { shared: 'rooms/a', file: 'catalog.json' } },
			'/out/shared/rooms/a/modules.json': { modules: [] },
			'/out/shared/rooms/a/catalog.json': { assets: [] }
		};
		vi.stubGlobal( 'fetch', vi.fn( async url => response( docs[ url ] ? 200 : 404, docs[ url ] ?? null ) ) );
		const assets = new BuildingAssets( 'p1', '/out/previews' );
		const source = await assets.inspectScene( 'interior' );
		expect( source ).toMatchObject( { available: true, format: 'placements' } );
		expect( await assets.loadInterior( source ) ).toMatchObject( {
			building, layouts: { ground: { id: 'ground' } }, modules: { baseUrl: '/out/shared/rooms/a' }, props: { document: { assets: [] } }
		} );
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
