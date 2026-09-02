// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
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
			json: async () => ( { code: 'E_WORLD_NOT_FOUND', message: 'missing has no Atlas sample' } )
		} ) );
		const app = new BuildingViewerApp( { parcel: 'p9', out: '/out/missing', source: 'shell', backend: 'webgl' } );

		await app.start();

		expect( screen.getByText( 'E_WORLD_NOT_FOUND: missing has no Atlas sample' ).classList.contains( 'error-box' ) ).toBe( true );

	} );

} );
