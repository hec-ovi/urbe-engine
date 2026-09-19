import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { RepeatWrapping, SRGBColorSpace } from 'three/webgpu';
import binding from '../../../../../materials/bindings/street-native.json' with { type: 'json' };
import { NativeTextureSource } from './NativeTextureSource.js';

const id = 'asphalt-basecolor';
const definition = binding.textures[ id ];
const path = definition.path.slice( 'themes/'.length );
const bytes = await readFile( new URL( `../../../../../materials/${definition.path}`, import.meta.url ) );
const image = () => ( { width: definition.resolution[ 0 ], height: definition.resolution[ 1 ] } );
const options = () => ( { fetch: vi.fn( async () => new Response( bytes ) ), decode: vi.fn( async () => image() ) } );

describe( 'NativeTextureSource public resource port', () => {
	it( 'loads through the browser-compatible default fetch port', async () => {
		const fetchMap = vi.spyOn( globalThis, 'fetch' ).mockImplementation( async function () {
			if ( this !== undefined && this !== globalThis ) throw new TypeError( 'Illegal invocation' );
			return new Response( bytes );
		} );
		const source = new NativeTextureSource( { decode: async () => image() } );
		try {
			await expect( source.load( id, path, definition ).ready ).resolves.toBeUndefined();
			expect( fetchMap ).toHaveBeenCalledOnce();
		} finally {
			source.dispose();
			fetchMap.mockRestore();
		}
	} );

	it( 'draws a map whose bytes moved on from the catalog hash, and says so', async () => {

		const ports = options();
		const warned = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const source = new NativeTextureSource( ports );
		try {

			const stale = { ...definition, sha256: 'f'.repeat( 64 ) };
			const resource = source.load( id, path, stale );
			await expect( resource.ready ).resolves.toBeUndefined();
			expect( resource.texture.version ).toBe( 1 );
			expect( warned ).toHaveBeenCalledOnce();

		} finally {

			source.dispose();
			warned.mockRestore();

		}

	} );

	it( 'verifies original bytes and waits for budgeting before readiness, sharing one source image', async () => {
		const ports = options();
		let prepared;
		ports.prepareTexture = vi.fn( () => new Promise( resolve => { prepared = resolve; } ) );
		const source = new NativeTextureSource( ports );
		const resource = source.load( id, path, definition );
		expect( source.load( id, path, definition ) ).toBe( resource );
		await vi.waitFor( () => expect( ports.prepareTexture ).toHaveBeenCalledOnce() );
		expect( resource.texture.version ).toBe( 0 );
		prepared();
		await resource.ready;
		expect( ports.fetch ).toHaveBeenCalledOnce();
		expect( ports.fetch ).toHaveBeenCalledWith( `/materials/${path}`, expect.objectContaining( { signal: expect.any( AbortSignal ) } ) );
		expect( resource.texture ).toMatchObject( { flipY: true, colorSpace: SRGBColorSpace, wrapS: RepeatWrapping, version: 1 } );
		const disposed = vi.fn(); resource.texture.addEventListener( 'dispose', disposed );
		source.dispose();
		expect( disposed ).toHaveBeenCalledOnce();
		expect( resource.texture.image ).toBeNull();
		expect( () => source.load( id, path, definition ) ).toThrow( /disposed/ );
	} );

	it.each( [ 'prepare' ] )( 'rejects %s failures without a substitute texture', async kind => {
		const ports = options();
		if ( kind === 'prepare' ) ports.prepareTexture = () => { throw new Error( 'budget failed' ); };
		const source = new NativeTextureSource( ports ), resource = source.load( id, path, definition );
		await expect( resource.ready ).rejects.toMatchObject( { code: 'E_STREET_TEXTURE' } );
		expect( resource.texture.image ).toBeNull();
		source.dispose();
	} );

	it( 'rejects unsafe references and identity conflicts, and cancels pending sources on disposal', async () => {
		const ports = options(), source = new NativeTextureSource( ports );
		expect( () => source.load( id, '../source.png', definition ) ).toThrow( /Invalid native texture reference/ );
		expect( ports.fetch ).not.toHaveBeenCalled();
		const resource = source.load( id, path, definition );
		expect( () => source.load( id, path, { ...definition, sha256: '0'.repeat( 64 ) } ) ).toThrow( /Conflicting street texture identity/ );
		source.dispose();
		await expect( resource.ready ).rejects.toMatchObject( { code: 'E_STREET_TEXTURE' } );
		expect( ports.decode ).not.toHaveBeenCalled();
	} );
} );
