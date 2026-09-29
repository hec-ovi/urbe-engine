// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { PbrMaterialFactory } from './PbrMaterialFactory.js';
import { PbrTextureBudget } from './PbrTextureBudget.js';
import { fakeResolver } from './material-resolver.test-fixtures.js';

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
	const factory = new PbrMaterialFactory( fakeResolver( () => source, ( theme, path ) => `/${theme}/${path}` ), profile );
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
			else expect( image.context.drawImage ).toHaveBeenCalledExactlyOnceWith( sources[ i ], 0, 0, ...expected[ i ] );
			expect( texture.repeat.toArray() ).toEqual( [ 0.5, 0.25 ] );
			expect( texture.wrapS ).toBe( THREE.RepeatWrapping );
			expect( texture.flipY ).toBe( false );
			expect( texture.anisotropy ).toBe( 4 );
			expect( texture.colorSpace ).toBe( i === 0 || i === 5 ? THREE.SRGBColorSpace : THREE.NoColorSpace );

		}
		expect( material.roughness ).toBe( 1 );
		expect( material.metalness ).toBe( 1 );
		expect( factory.build( 'cyberpunk/wall/mid', 'native' ) ).toBe( material );
		expect( requests ).toHaveLength( 6 );

	} );

	it( 'keeps source resolution without a budget, resizes decals with alpha, settles a failed resize on catalog scalars and rejects an invalid budget', async () => {

		const untouched = fixture( { materialMaps: [ 'normal' ] } );
		const kept = untouched.factory.build( 'cyberpunk/wall/mid' );
		const source = { naturalWidth: 4096, naturalHeight: 2048 };
		untouched.requests[ 0 ].complete( source );
		await kept.normalMap[ READY ];
		expect( kept.normalMap.image ).toBe( source );
		expect( untouched.canvases ).toHaveLength( 0 );

		const decalSource = { ...entry, alignment: 'exact', decal: { worldSize: [ 2, 1 ] }, physical: { alphaMode: 'BLEND' } };
		const decal = fixture( { textureMaxSize: 256, materialMaps: [ 'basecolor' ] }, decalSource );
		const fitted = decal.factory.build( 'cyberpunk/decal/mid' );
		decal.requests[ 0 ].complete( { naturalWidth: 2048, naturalHeight: 1024 } );
		await fitted.map[ READY ];
		expect( fitted.map.image.options.alpha ).toBe( true );
		expect( [ fitted.map.image.width, fitted.map.image.height ] ).toEqual( [ 256, 128 ] );
		expect( fitted.map.wrapS ).toBe( THREE.ClampToEdgeWrapping );
		expect( fitted.map.premultiplyAlpha ).toBe( false );

		const failing = fixture( { textureMaxSize: 256 } );
		vi.stubGlobal( 'OffscreenCanvas', class { getContext() { return null; } } );
		const material = failing.factory.build( 'cyberpunk/wall/mid' );
		const copy = failing.factory.variant( 'cyberpunk/wall/mid', { emissiveLevel: 2 } );
		const textures = PROPERTIES.map( property => material[ property ] );
		failing.requests.forEach( request => request.complete( { naturalWidth: 2048, naturalHeight: 2048 } ) );
		await Promise.all( textures.map( texture => texture[ READY ] ) );
		for ( const surface of [ material, copy ] ) {

			for ( const property of PROPERTIES ) expect( surface[ property ] ).toBeNull();
			expect( surface.roughness ).toBe( 0.63 );
			expect( surface.metalness ).toBe( 0.31 );

		}

		for ( const textureMaxSize of [ 0, - 1, 2.5, Infinity, null ] ) expect( () => new PbrMaterialFactory( {}, { textureMaxSize } ) )
			.toThrow( expect.objectContaining( { code: 'E_PBR_TEXTURE_BUDGET' } ) );

	} );

} );

describe( 'PbrTextureBudget on compressed maps', () => {

	const compressedTexture = ( width, height ) => {

		const levels = [];
		for ( let w = width, h = height; ; w = Math.max( 1, w >> 1 ), h = Math.max( 1, h >> 1 ) ) {

			levels.push( { width: w, height: h, data: new Uint8Array( Math.ceil( w / 4 ) * Math.ceil( h / 4 ) * 16 ) } );
			if ( w === 1 && h === 1 ) break;

		}
		return new THREE.CompressedTexture( levels, width, height, THREE.RGBA_BPTC_Format );

	};

	/**
	 * The quality tier bounds every map's size. A PNG is redrawn smaller; a
	 * compressed map already carries its smaller levels, so the tier starts it
	 * at the first level that fits, never at one that is not whole blocks.
	 */
	it( 'starts a compressed map at its first level inside the tier\'s size, never at one that is not whole 4x4 blocks', () => {

		const map = compressedTexture( 4096, 2304 );
		const levels = map.mipmaps;
		new PbrTextureBudget( 1024 ).fit( map );
		expect( map.image ).toEqual( { width: 1024, height: 576 } );
		expect( map.mipmaps ).toEqual( levels.slice( 2 ) );

		const screen = compressedTexture( 1280, 720 );
		new PbrTextureBudget( 256 ).fit( screen );
		expect( screen.image ).toEqual( { width: 320, height: 180 } );

		const fitting = compressedTexture( 512, 512 );
		const version = fitting.version;
		new PbrTextureBudget( 2048 ).fit( fitting );
		new PbrTextureBudget().fit( fitting );
		expect( fitting.mipmaps ).toHaveLength( 10 );
		expect( fitting.version ).toBe( version );

	} );

} );
