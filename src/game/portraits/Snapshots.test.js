import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Snapshots, picture } from './Snapshots.js';

/** A renderer that records what is drawn where and reads back a lit square. */
function fakeRenderer( { webgpu = false, fail = false } = {} ) {

	const calls = [];
	let target = null;
	const renderer = {
		backend: { isWebGPUBackend: webgpu },
		toneMapping: THREE.AgXToneMapping,
		outputColorSpace: THREE.SRGBColorSpace,
		getRenderTarget: () => target,
		setRenderTarget: ( next ) => { target = next; calls.push( [ 'target', next ] ); },
		getMRT: () => 'frame-mrt',
		setMRT: ( mrt ) => calls.push( [ 'mrt', mrt ] ),
		getClearColor: ( color ) => color.set( 0x102030 ),
		getClearAlpha: () => 1,
		setClearColor: ( color, alpha ) => calls.push( [ 'clear-color', alpha ] ),
		clear: () => calls.push( [ 'clear' ] ),
		render: ( scene, camera ) => {

			if ( fail ) throw new Error( 'no pipeline' );
			calls.push( [ 'render', scene.name, renderer.toneMapping ] );

		},
		readRenderTargetPixelsAsync: vi.fn( async ( rt, x, y, w, h ) => new Float32Array( w * h * 4 ).fill( 1 ) )
	};
	return { renderer, calls };

}

describe( 'Snapshots', () => {

	it( 'tone maps a linear read-back over the backdrop, in sRGB, the right way up', () => {

		// Two rows of two: the bottom row (first in a WebGL read) lit, the top transparent.
		const pixels = new Float32Array( [ 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0 ] );
		const flipped = picture( pixels, 2, { flip: true } );
		const lit = Math.round( 255 * ( 1.055 * Math.pow( 2.54 / 3.16, 1 / 2.4 ) - 0.055 ) );
		expect( [ ...flipped.data.slice( 8, 12 ) ] ).toEqual( [ lit, lit, lit, 255 ] );
		expect( flipped.data[ 0 ] ).toBeLessThan( 90 );
		expect( [ ...flipped.data.slice( 0, 4 ) ].at( 3 ) ).toBe( 255 );
		const upright = picture( pixels, 2 );
		expect( [ ...upright.data.slice( 0, 3 ) ] ).toEqual( [ lit, lit, lit ] );

		// Half floats read back from WebGPU come as 16-bit words.
		const half = new Uint16Array( 4 ).fill( THREE.DataUtils.toHalfFloat( 1 ) );
		expect( [ ...picture( half, 1 ).data.slice( 0, 3 ) ] ).toEqual( [ lit, lit, lit ] );

	} );

	it( 'stages, draws and reads back one picture a step, untoned and without the frame\'s MRT, and puts the renderer back', async () => {

		const { renderer, calls } = fakeRenderer();
		const encode = vi.fn( async ( { size } ) => `blob:${size}` );
		const snapshots = new Snapshots( { renderer, size: 4, encode } );
		const done = vi.fn();
		const scene = new THREE.Scene();
		scene.name = 'portrait';
		const taken = snapshots.take( async () => ( { scene, camera: new THREE.PerspectiveCamera(), done } ) );
		const second = snapshots.take( () => null );
		expect( snapshots.pending ).toBe( 2 );

		// The picture asked for last goes first: a stage with nothing to draw resolves null.
		snapshots.step();
		await expect( second ).resolves.toBeNull();
		await vi.waitFor( () => expect( snapshots.busy ).toBe( false ) );
		expect( snapshots.pending ).toBe( 1 );

		snapshots.step();
		await vi.waitFor( () => expect( snapshots.busy ).toBe( false ) );
		expect( calls ).toEqual( [] );

		snapshots.step();
		expect( done ).toHaveBeenCalledOnce();
		expect( calls.find( ( call ) => call[ 0 ] === 'render' ) ).toEqual( [ 'render', 'portrait', THREE.NoToneMapping ] );
		expect( calls.filter( ( call ) => call[ 0 ] === 'mrt' ).map( ( call ) => call[ 1 ] ) ).toEqual( [ null, 'frame-mrt' ] );
		expect( renderer.toneMapping ).toBe( THREE.AgXToneMapping );
		expect( renderer.getRenderTarget() ).toBeNull();
		snapshots.step();
		expect( calls.filter( ( call ) => call[ 0 ] === 'render' ) ).toHaveLength( 1 );
		await expect( taken ).resolves.toBe( 'blob:4' );
		expect( renderer.readRenderTargetPixelsAsync ).toHaveBeenCalledWith( snapshots.target, 0, 0, 4, 4 );
		expect( snapshots.pending ).toBe( 0 );

	} );

	it( 'answers null when a picture cannot be drawn, and keeps going', async () => {

		const { renderer } = fakeRenderer( { fail: true } );
		vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const snapshots = new Snapshots( { renderer, size: 2, encode: async () => 'blob:x' } );
		const done = vi.fn();
		const taken = snapshots.take( () => ( { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), done } ) );
		snapshots.step();
		await vi.waitFor( () => expect( snapshots.busy ).toBe( false ) );
		snapshots.step();
		await expect( taken ).resolves.toBeNull();
		expect( done ).toHaveBeenCalledOnce();
		expect( renderer.getRenderTarget() ).toBeNull();
		vi.restoreAllMocks();

	} );

} );
