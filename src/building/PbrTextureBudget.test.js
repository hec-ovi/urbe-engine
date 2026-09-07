// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';

const READY = Symbol.for( 'urbe.texture-ready' );
const PROPERTIES = [ 'map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap' ];
const entry = {
	alignment: 'tile', tiling: { worldSize: [ 2, 4 ] }, physical: { roughnessFactor: 0.63, metallicFactor: 0.31 },
	variants: [ { id: 'native', maps: { basecolor: 'color.png', normal: 'normal.png', roughness: 'rough.png', metallic: 'metal.png', ao: 'ao.png', emission: 'light.png' } } ]
};

afterEach( () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); } );

function fixture( profile, source = entry ) {

	const requests = [], canvases = [];
	vi.spyOn( THREE.ImageLoader.prototype, 'load' ).mockImplementation( ( url, onLoad ) => {

		requests.push( { url, complete: onLoad } );
		return {};

	} );
	vi.stubGlobal( 'OffscreenCanvas', class {

		constructor( width, height ) {

			Object.assign( this, { width, height, context: { drawImage: vi.fn() } } );
			canvases.push( this );

		}

		getContext( kind, options ) { this.options = options; return this.context; }

	} );
	const factory = new PbrMaterialFactory( { resolve: () => source, mapUrl: ( theme, path ) => `/${theme}/${path}` }, profile );
	return { factory, requests, canvases };

}

describe( 'PbrMaterialFactory texture dimensions', () => {

	it( 'bounds every enabled native map before readiness while preserving metre scale and shared texture identity', async () => {

		const { factory, requests, canvases } = fixture( { textureMaxSize: 512, textureAnisotropy: 4 } );
		const material = factory.build( 'cyberpunk/wall/mid', 'native' );
		const copy = factory.variant( 'cyberpunk/wall/mid', { variantId: 'native', side: THREE.DoubleSide } );
		const textures = PROPERTIES.map( property => material[ property ] );
		let ready = false;
		const pending = Promise.all( textures.map( texture => texture[ READY ] ) ).then( () => { ready = true; } );
		await Promise.resolve();
		expect( ready ).toBe( false );
		const sources = [ [ 2048, 1024 ], [ 1024, 2048 ], [ 1536, 1536 ], [ 97, 113 ], [ 258, 1024 ], [ 4096, 1 ] ]
			.map( ( [ width, height ], i ) => ( { naturalWidth: width, naturalHeight: height, nativeSource: requests[ i ].url } ) );
		requests.forEach( ( request, i ) => request.complete( sources[ i ] ) );
		await pending;
		expect( ready ).toBe( true );
		expect( canvases ).toHaveLength( 5 );
		const expected = [ [ 512, 256 ], [ 256, 512 ], [ 512, 512 ], [ 97, 113 ], [ 129, 512 ], [ 512, 1 ] ];
		for ( const [ i, property ] of PROPERTIES.entries() ) {

			const texture = material[ property ];
			expect( texture ).toBe( textures[ i ] );
			expect( copy[ property ] ).toBe( texture );
			const image = texture.image;
			expect( [ image.width ?? image.naturalWidth, image.height ?? image.naturalHeight ] ).toEqual( expected[ i ] );
			if ( i === 3 ) expect( image ).toBe( sources[ i ] );
			else {

				expect( image.context.drawImage ).toHaveBeenCalledExactlyOnceWith( sources[ i ], 0, 0, ...expected[ i ] );
				expect( image.context.imageSmoothingEnabled ).toBe( true );
				expect( image.context.imageSmoothingQuality ).toBe( 'high' );

			}
			expect( texture.repeat.toArray() ).toEqual( [ 0.5, 0.25 ] );
			expect( texture.wrapS ).toBe( THREE.RepeatWrapping );
			expect( texture.flipY ).toBe( false );
			expect( texture.anisotropy ).toBe( 4 );
			expect( texture.colorSpace ).toBe( i === 0 || i === 5 ? THREE.SRGBColorSpace : THREE.NoColorSpace );
			const dispose = vi.fn();
			texture.addEventListener( 'dispose', dispose );
			texture.dispose();
			expect( dispose ).toHaveBeenCalledOnce();

		}
		expect( material.roughness ).toBe( 1 );
		expect( material.metalness ).toBe( 1 );
		expect( factory.build( 'cyberpunk/wall/mid', 'native' ) ).toBe( material );
		expect( requests ).toHaveLength( 6 );

	} );

	it( 'keeps exact RGBA decals on the same clamped UVs with alpha-enabled resizing', async () => {

		const source = { ...entry, alignment: 'exact', decal: { worldSize: [ 2, 1 ] }, physical: { alphaMode: 'BLEND' } };
		const { factory, requests } = fixture( { textureMaxSize: 256, materialMaps: [ 'basecolor' ] }, source );
		const material = factory.build( 'cyberpunk/decal/mid' ), texture = material.map;
		requests[ 0 ].complete( { naturalWidth: 2048, naturalHeight: 1024 } );
		await texture[ READY ];
		expect( texture.image.options.alpha ).toBe( true );
		expect( [ texture.image.width, texture.image.height ] ).toEqual( [ 256, 128 ] );
		expect( texture.repeat.toArray() ).toEqual( [ 1, 1 ] );
		expect( texture.wrapS ).toBe( THREE.ClampToEdgeWrapping );
		expect( texture.premultiplyAlpha ).toBe( false );
		expect( material.transparent ).toBe( true );
		expect( material.depthWrite ).toBe( false );
		expect( material.alphaMap ).toBeNull();

	} );

	it( 'keeps source resolution when the optional budget is absent', async () => {

		const { factory, requests, canvases } = fixture( { materialMaps: [ 'normal' ] } );
		const material = factory.build( 'cyberpunk/wall/mid' );
		const source = { naturalWidth: 4096, naturalHeight: 2048 };
		requests[ 0 ].complete( source );
		await material.normalMap[ READY ];
		expect( material.normalMap.image ).toBe( source );
		expect( canvases ).toHaveLength( 0 );

	} );

	it( 'applies the same budget through a DOM canvas when offscreen canvases are unavailable', async () => {

		const { factory, requests } = fixture( { textureMaxSize: 256, materialMaps: [ 'normal' ] } );
		vi.stubGlobal( 'OffscreenCanvas', undefined );
		const context = { drawImage: vi.fn() };
		vi.spyOn( HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( context );
		const material = factory.build( 'cyberpunk/wall/mid' );
		const source = { naturalWidth: 640, naturalHeight: 320 };
		requests[ 0 ].complete( source );
		await material.normalMap[ READY ];
		expect( material.normalMap.image ).toBeInstanceOf( HTMLCanvasElement );
		expect( [ material.normalMap.image.width, material.normalMap.image.height ] ).toEqual( [ 256, 128 ] );
		expect( context.drawImage ).toHaveBeenCalledExactlyOnceWith( source, 0, 0, 256, 128 );

	} );

	it( 'settles a failed resize without uploading the oversized image or changing catalog fallback values', async () => {

		const { factory, requests } = fixture( { textureMaxSize: 256 } );
		vi.stubGlobal( 'OffscreenCanvas', class { getContext() { return null; } } );
		const material = factory.build( 'cyberpunk/wall/mid' );
		const copy = factory.variant( 'cyberpunk/wall/mid', { emissiveLevel: 2 } );
		const textures = PROPERTIES.map( property => material[ property ] );
		requests.forEach( request => request.complete( { naturalWidth: 2048, naturalHeight: 2048 } ) );
		await Promise.all( textures.map( texture => texture[ READY ] ) );
		for ( const surface of [ material, copy ] ) {

			for ( const property of PROPERTIES ) expect( surface[ property ] ).toBeNull();
			expect( surface.roughness ).toBe( 0.63 );
			expect( surface.metalness ).toBe( 0.31 );

		}
		for ( const texture of textures ) expect( texture.image ).toBeNull();

	} );

	it( 'rejects an invalid pixel budget before issuing texture requests', () => {

		const load = vi.spyOn( THREE.TextureLoader.prototype, 'load' );
		for ( const textureMaxSize of [ 0, - 1, 2.5, Infinity, null ] ) expect( () => new PbrMaterialFactory( {}, { textureMaxSize } ) )
			.toThrow( expect.objectContaining( { code: 'E_PBR_TEXTURE_BUDGET' } ) );
		expect( load ).not.toHaveBeenCalled();

	} );

} );
