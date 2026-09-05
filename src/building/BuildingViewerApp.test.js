// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingViewerApp, materialForViewerSurface } from './BuildingViewerApp.js';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';

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

	it( 'resolves an authored interior variant and preserves its two-sided surface', () => {

		const maps = ( id ) => ( { basecolor: `${id}.png`, roughness: `${id}-r.png`, metallic: `${id}-m.png` } );
		const factory = new PbrMaterialFactory( {
			resolve: () => ( {
				alignment: 'tile', tiling: { worldSize: [ 1.5, 3 ] },
				physical: { roughnessFactor: 0.64, metallicFactor: 0 },
				variants: [ { id: 'blind', maps: maps( 'blind' ) }, { id: 'shade', maps: maps( 'shade' ) } ]
			} ),
			mapUrl: ( theme, path ) => `/materials/${theme}/${path}`
		} );
		factory.loader = { load: ( url, onLoad ) => {

			const texture = new THREE.Texture( { src: url } );
			queueMicrotask( () => onLoad( texture ) );
			return texture;

		} };
		const source = new THREE.MeshStandardMaterial( { side: THREE.DoubleSide, roughness: 0.64, metalness: 0 } );
		source.name = 'cyberpunk/curtain/high_rich';
		source.userData.materialVariant = 'shade';

		const result = materialForViewerSurface( factory, source, 'p1' );

		expect( result.side ).toBe( THREE.DoubleSide );
		expect( result.map.image.src ).toContain( '/materials/cyberpunk/shade.png' );
		expect( result.map.repeat.toArray() ).toEqual( [ 1 / 1.5, 1 / 3 ] );
		expect( result.roughnessMap.image.src ).toContain( '/materials/cyberpunk/shade-r.png' );
		expect( result.metalnessMap.image.src ).toContain( '/materials/cyberpunk/shade-m.png' );
		expect( result.roughness ).toBe( 1 );
		expect( result.metalness ).toBe( 1 );
		expect( source.roughness ).toBe( 0.64 );

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
		const retry = vi.fn();
		app.view.onRetry = retry;

		await app.start();

		expect( screen.getByRole( 'alert' ).dataset.state ).toBe( 'failed' );
		expect( screen.getByRole( 'heading', { name: 'exterior failed' } ) ).toBeTruthy();
		expect( screen.getByText( 'missing has no Atlas sample' ) ).toBeTruthy();
		expect( screen.getByText( /E_WORLD_NOT_FOUND:/ ) ).toBeTruthy();
		expect( screen.getByText( /p9 · shell · failed/ ).dataset.state ).toBe( 'failed' );
		await userEvent.click( screen.getByRole( 'button', { name: 'retry' } ) );
		expect( retry ).toHaveBeenCalledOnce();

	} );

	it( 'names an unreadable successful build response and keeps retry available', async () => {

		vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		vi.stubGlobal( 'fetch', vi.fn().mockResolvedValue( response( 200, '<!doctype html>', 'text/html' ) ) );
		const app = new BuildingViewerApp( { parcel: 'p113', out: '/out/urbe', source: 'interior', backend: 'webgl' } );
		const retry = vi.fn();
		app.view.onRetry = retry;

		await app.start();

		expect( screen.getByRole( 'alert' ).dataset.state ).toBe( 'failed' );
		expect( screen.getByRole( 'heading', { name: 'interior failed' } ) ).toBeTruthy();
		expect( screen.getByText( 'The preview builder returned an unreadable response.' ) ).toBeTruthy();
		expect( screen.getByText( /E_BUILD_RESPONSE: POST \/api\/building returned 200 text\/html/ ) ).toBeTruthy();
		expect( screen.getByText( 'p113 · interior · failed' ).dataset.state ).toBe( 'failed' );
		await userEvent.click( screen.getByRole( 'button', { name: 'retry' } ) );
		expect( retry ).toHaveBeenCalledOnce();

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
		const retry = vi.fn();
		app.view.onRetry = retry;

		await app.start();

		expect( screen.getByRole( 'heading', { name: 'interior unavailable' } ) ).toBeTruthy();
		expect( screen.getByText( 'p113 has no generated interior in /out/urbe/p113.' ) ).toBeTruthy();
		expect( screen.getByText( /HEAD \/out\/urbe\/p113\/interior\/building\.glb returned 200 text\/html/ ) ).toBeTruthy();
		expect( screen.getByLabelText( 'source' ).value ).toBe( 'interior' );
		expect( screen.getByText( 'p113 · interior · unavailable' ).dataset.state ).toBe( 'unavailable' );

		await userEvent.click( screen.getByRole( 'button', { name: 'retry generation' } ) );
		expect( retry ).toHaveBeenCalledOnce();
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
