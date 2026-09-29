// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { TextureSource } from './TextureSource.js';

afterEach( () => { vi.unstubAllGlobals(); } );

/** Every compressed format a Mesa desktop driver lists, the emulated ones included. */
const MESA = { astcSupported: true, astcHDRSupported: false, etc1Supported: true, etc2Supported: true, dxtSupported: true, bptcSupported: true, pvrtcSupported: false };

function loader( config = { ...MESA }, load = () => {} ) {

	return { workerConfig: null, detectSupport() { this.workerConfig = config; }, load, dispose() {} };

}

function compressedTexture( width, height, format = THREE.RGBA_BPTC_Format ) {

	const levels = [];
	for ( let w = width, h = height; ; w = Math.max( 1, w >> 1 ), h = Math.max( 1, h >> 1 ) ) {

		levels.push( { width: w, height: h, data: new Uint8Array( Math.ceil( w / 4 ) * Math.ceil( h / 4 ) * 16 ) } );
		if ( w === 1 && h === 1 ) break;

	}
	return new THREE.CompressedTexture( levels, width, height, format );

}

describe( 'TextureSource', () => {

	/**
	 * The game draws through WebGPURenderer, whose WebGL2 fallback lists what
	 * the driver lists. On desktop Linux Mesa lists ETC and ASTC and unpacks
	 * them itself at upload, on the main thread; three only filters that for
	 * its WebGLRenderer. Every ETC1S map would transcode to ETC2 and stall.
	 */
	it( 'transcodes to the BC formats instead of the ones Mesa emulates when the WebGL2 fallback draws on desktop Linux', () => {

		vi.stubGlobal( 'navigator', { platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } );

		const webgl = new TextureSource( { ktx2: loader() } ).detect( { backend: { isWebGLBackend: true } } );
		expect( webgl.ktx2.workerConfig ).toMatchObject( { astcSupported: false, etc1Supported: false, etc2Supported: false, bptcSupported: true, dxtSupported: true } );
		expect( webgl.compressed ).toBe( true );

		const webgpu = new TextureSource( { ktx2: loader() } ).detect( { backend: { isWebGPUBackend: true } } );
		expect( webgpu.ktx2.workerConfig ).toEqual( MESA );

		const noBc = { ...MESA, bptcSupported: false, dxtSupported: false };
		expect( new TextureSource( { ktx2: loader( { ...noBc } ) } ).detect( { backend: { isWebGLBackend: true } } ).ktx2.workerConfig ).toEqual( noBc );

		vi.stubGlobal( 'navigator', { platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14)' } );
		expect( new TextureSource( { ktx2: loader() } ).detect( { backend: { isWebGLBackend: true } } ).ktx2.workerConfig ).toEqual( MESA );

	} );

	/**
	 * WebGPU refuses a block-compressed texture whose first level is not whole
	 * 4x4 blocks, and the surface then draws with no map at all, although its
	 * PNG master is right there. Maps like that draw from the master.
	 */
	it( 'draws a compressed map whose first level is not whole 4x4 blocks from its PNG master, and any other compressed map as it is', async () => {

		const asked = [];
		const transcoded = { 'a.ktx2': compressedTexture( 1000, 350 ), 'b.ktx2': compressedTexture( 1024, 768 ), 'c.ktx2': compressedTexture( 1000, 350, THREE.RGBAFormat ) };
		const source = new TextureSource( {
			images: { load: ( url, onLoad ) => { asked.push( url ); queueMicrotask( () => onLoad( new THREE.Texture( { width: 1000, height: 350 } ) ) ); } },
			ktx2: loader( { ...MESA }, ( url, onLoad ) => { asked.push( url ); queueMicrotask( () => onLoad( transcoded[ url ] ) ); } )
		} ).detect( {} );
		const load = ( map ) => new Promise( ( resolve, reject ) => source.load( map, resolve, reject ) );

		const unaligned = await load( { image: 'a.png', ktx2: 'a.ktx2' } );
		expect( asked ).toEqual( [ 'a.ktx2', 'a.png' ] );
		expect( unaligned.isCompressedTexture ).toBeFalsy();
		expect( unaligned.image ).toEqual( { width: 1000, height: 350 } );

		const aligned = await load( { image: 'b.png', ktx2: 'b.ktx2' } );
		expect( aligned.isCompressedTexture ).toBe( true );
		expect( aligned.mipmaps ).toBe( transcoded[ 'b.ktx2' ].mipmaps );
		expect( aligned.format ).toBe( THREE.RGBA_BPTC_Format );

		const unpacked = await load( { image: 'c.png', ktx2: 'c.ktx2' } );
		expect( unpacked.format ).toBe( THREE.RGBAFormat );
		expect( asked ).toEqual( [ 'a.ktx2', 'a.png', 'b.ktx2', 'c.ktx2' ] );

	} );

} );
