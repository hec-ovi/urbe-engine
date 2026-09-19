import { describe, expect, it } from 'vitest';
import { RenderWork } from './RenderWork.js';

/**
 * Thirty of the forty-two freezes in a walk across the small city printed "no
 * world event in this gap": the world had done nothing, the renderer had. The
 * note has to say what it built and for whom, count a program dropped and
 * linked again in the same frame (which the net counters hide), and stay quiet
 * about a frame that built nothing.
 */
describe( 'RenderWork', () => {

	it( 'names the programs linked and released and the maps uploaded, and stays quiet about a frame that built nothing', () => {

		const info = {
			memoryMap: new Map(),
			createProgram() {}, destroyProgram() {}, createTexture() {}, destroyTexture() {}
		};
		const work = new RenderWork( info );

		expect( work.since() ).toBe( null );

		const brick = { name: 'kit-plans:brick', stage: 'vertex' };
		info.destroyProgram( brick );
		info.destroyProgram( { name: 'kit-plans:brick', stage: 'fragment' } );
		info.createProgram( brick );
		info.createProgram( { name: 'kit-plans:brick', stage: 'fragment' } );
		info.createProgram( { name: '', stage: 'fragment' } );
		const map = {};
		info.memoryMap.set( map, 12 << 20 );
		info.createTexture( map );
		info.createTexture( {} );

		expect( work.since() ).toBe( '3 shaders linked (kit-plans:brick vertex, kit-plans:brick fragment, unnamed fragment), 2 shaders released, 2 textures uploaded (12 MB)' );
		expect( work.since() ).toBe( null );

		for ( let i = 0; i < 8; i ++ ) info.createProgram( { name: `m${i}`, stage: 'vertex' } );
		expect( work.since() ).toBe( '8 shaders linked (m0 vertex, m1 vertex, m2 vertex, m3 vertex, m4 vertex, m5 vertex, 2 more)' );

		info.destroyTexture( map );
		expect( work.since() ).toBe( null );

	} );

} );
