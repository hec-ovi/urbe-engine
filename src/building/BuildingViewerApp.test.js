// @vitest-environment jsdom
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { BuildingViewerApp, materialForViewerSurface } from './BuildingViewerApp.js';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';
import { fakeResolver } from './material-resolver.test-fixtures.js';
import { TextureSource } from './TextureSource.js';

const fakeTextures = ( load ) => new TextureSource( {
	images: { load: ( url, onLoad, onProgress, onError ) => load( url, onLoad, onError ) },
	ktx2: { load() {}, detectSupport() {}, dispose() {} }
} );

describe( 'building navigation', () => {

	afterEach( () => {

		document.body.replaceChildren();
		window.history.replaceState( null, '', '/' );
		vi.unstubAllGlobals();
		vi.restoreAllMocks();

	} );

	it( 'reads parcel, output, source, backend and quality from the URL, defaulting to the exterior shell', () => {

		window.history.replaceState( null, '', '/?mode=building&parcel=p136&out=/out/urbe' );
		expect( BuildingViewerApp.configFromUrl() ).toMatchObject( { parcel: 'p136', out: '/out/urbe', source: 'shell' } );

		window.history.replaceState( null, '', '/?mode=building&parcel=p2&out=/out/small&source=interior&backend=webgl' );
		expect( BuildingViewerApp.configFromUrl() ).toEqual( {
			parcel: 'p2', out: '/out/small', source: 'interior', backend: 'webgl', quality: null
		} );

	} );

	it( 'resolves the published variant and preserves an authored two-sided surface', () => {

		const maps = ( id ) => ( { basecolor: `${id}.png`, roughness: `${id}-r.png`, metallic: `${id}-m.png` } );
		const factory = new PbrMaterialFactory( fakeResolver( () => ( {
			alignment: 'tile', tiling: { worldSize: [ 1.5, 3 ] },
			physical: { roughnessFactor: 0.64, metallicFactor: 0 },
			variants: [ { id: 'blind', maps: maps( 'blind' ) }, { id: 'shade', maps: maps( 'shade' ) } ]
		} ) ) );
		factory.textures = fakeTextures( ( url, onLoad ) => {

			const texture = new THREE.Texture( { src: url } );
			queueMicrotask( () => onLoad( texture ) );
			return texture;

		} );
		const source = new THREE.MeshStandardMaterial( { side: THREE.DoubleSide, roughness: 0.64, metalness: 0 } );
		source.name = 'cyberpunk/curtain/high_rich';
		source.userData.materialVariant = 'shade';
		const blueprint = { materialVariants: { 'cyberpunk/curtain/high_rich': 'blind' } };

		const published = new THREE.MeshStandardMaterial();
		published.name = source.name;

		const result = materialForViewerSurface( factory, source, { parcel: 'p1', blueprint } );

		expect( result.side ).toBe( THREE.DoubleSide );
		expect( result.userData.basecolorUrl ).toBe( '/materials/cyberpunk/shade.png' );
		expect( result.map.repeat.toArray() ).toEqual( [ 1 / 1.5, 1 / 3 ] );
		expect( result.roughness ).toBe( 1 );
		expect( result.metalness ).toBe( 1 );
		expect( source.roughness ).toBe( 0.64 );
		// Nothing authored on the surface: the building's published choice wins.
		expect( materialForViewerSurface( factory, published, { parcel: 'p1', blueprint } ).userData.basecolorUrl )
			.toBe( '/materials/cyberpunk/blind.png' );

	} );

	it( 'reports an interior the world does not carry, with retry and exterior recovery', async () => {

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
