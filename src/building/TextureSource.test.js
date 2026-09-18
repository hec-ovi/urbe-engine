import { describe, expect, it, vi } from 'vitest';
import { TextureSource } from './TextureSource.js';

describe( 'texture source', () => {

	it( 'routes ktx2 files to the transcoder and images to the image loader', () => {

		const images = { load: vi.fn( () => 'image' ) };
		const ktx2 = { load: vi.fn( () => 'compressed' ), detectSupport: vi.fn(), dispose: vi.fn() };
		const source = new TextureSource( { images, ktx2 } );
		expect( source.load( '/m/basecolor.png', () => {} ) ).toBe( 'image' );
		expect( source.load( '/m/basecolor.ktx2', () => {} ) ).toBe( 'compressed' );
		expect( images.load ).toHaveBeenCalledTimes( 1 );
		expect( ktx2.load ).toHaveBeenCalledTimes( 1 );

	} );

	it( 'prefers the compressed path only after the renderer was detected', () => {

		const ktx2 = { load: vi.fn(), detectSupport: vi.fn(), dispose: vi.fn() };
		const source = new TextureSource( { images: { load: vi.fn() }, ktx2 } );
		const paths = { image: 'a.png', ktx2: 'a.ktx2' };
		expect( source.choose( paths ) ).toBe( 'a.png' );
		expect( source.detect( 'renderer' ).choose( paths ) ).toBe( 'a.ktx2' );
		expect( source.choose( { image: 'b.png' } ) ).toBe( 'b.png' );
		expect( ktx2.detectSupport ).toHaveBeenCalledWith( 'renderer' );

	} );

} );
