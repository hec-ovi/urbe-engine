// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BuildingViewerApp } from './BuildingViewerApp.js';

describe( 'building navigation', () => {

	afterEach( () => {

		document.body.replaceChildren();
		window.history.replaceState( null, '', '/' );
		vi.unstubAllGlobals();
		vi.restoreAllMocks();

	} );

	it( 'honors parcel and output while defaulting to the exterior shell', () => {

		window.history.replaceState( null, '', '/?mode=building&parcel=p136&out=/out/urbe' );

		expect( BuildingViewerApp.configFromUrl() ).toMatchObject( {
			parcel: 'p136', out: '/out/urbe', source: 'shell'
		} );

	} );

	it( 'honors an explicit interior source', () => {

		window.history.replaceState( null, '', '/?mode=building&parcel=p2&out=/out/small&source=interior&backend=webgl' );

		expect( BuildingViewerApp.configFromUrl() ).toEqual( {
			parcel: 'p2', out: '/out/small', source: 'interior', backend: 'webgl'
		} );

	} );

	it( 'shows the build boundary error when the selected output is absent', async () => {

		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( {
			ok: false,
			status: 404,
			headers: { get: () => 'application/json' },
			json: async () => ( { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } )
		} ) );
		const app = new BuildingViewerApp( { parcel: 'p9', out: '/out/missing', source: 'shell', backend: 'webgl' } );

		await app.start();

		expect( screen.getByRole( 'alert' ).dataset.state ).toBe( 'failed' );
		expect( screen.getByRole( 'heading', { name: 'exterior failed' } ) ).toBeTruthy();
		expect( screen.getByText( 'missing has no Atlas sample' ) ).toBeTruthy();
		expect( screen.getByText( /E_WORLD_NOT_FOUND:/ ) ).toBeTruthy();
		expect( screen.getByText( /p9 · shell · failed/ ).dataset.state ).toBe( 'failed' );

	} );

	it( 'reports the exact p113 HTML fallback as an unavailable interior with recovery', async () => {

		window.history.replaceState( null, '', '/?mode=building&parcel=p113&out=%2Fout%2Furbe&source=interior' );
		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		vi.stubGlobal( 'fetch', vi.fn( async ( url, options = {} ) => {

			if ( url === '/api/building' ) return response( 200, {
				parcel: 'p113', out: '/out/urbe', source: 'interior', built: false
			}, 'application/json' );
			if ( url.endsWith( 'p113.blueprint.json' ) ) return response( 200, { floors: [] }, 'application/json' );
			if ( options.method === 'HEAD' && url.endsWith( 'interior/building.glb' ) ) {

				return response( 200, '<!doctype html>', 'text/html' );

			}

			throw new Error( `unexpected request ${options.method ?? 'GET'} ${url}` );

		} ) );
		const app = new BuildingViewerApp( BuildingViewerApp.configFromUrl() );
		const navigate = vi.spyOn( app, 'navigate' ).mockImplementation( () => {} );

		await app.start();

		expect( screen.getByRole( 'heading', { name: 'interior unavailable' } ) ).toBeTruthy();
		expect( screen.getByText( 'p113 has no generated interior in /out/urbe/p113.' ) ).toBeTruthy();
		expect( screen.getByText( /HEAD \/out\/urbe\/p113\/interior\/building\.glb returned 200 text\/html/ ) ).toBeTruthy();
		expect( screen.getByLabelText( 'source' ).value ).toBe( 'interior' );
		expect( screen.getByText( 'p113 · interior · unavailable' ).dataset.state ).toBe( 'unavailable' );

		await userEvent.click( screen.getByRole( 'button', { name: 'return to exterior' } ) );
		expect( navigate ).toHaveBeenCalledWith( { source: 'shell' } );

	} );

} );

function response( status, body, type ) {

	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: ( name ) => name === 'content-type' ? type : null },
		json: async () => body
	};

}
