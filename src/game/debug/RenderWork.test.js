import { describe, expect, it } from 'vitest';
import { RenderWork } from './RenderWork.js';

/**
 * Thirty of the forty-two freezes in a walk across the small city printed "no
 * world event in this gap": the world had done nothing, the renderer had. These
 * are the three things the note has to get right for that line to stop lying:
 * a quiet frame stays quiet, a frame that built something says what and how
 * much, and letting a floor go is not a cost.
 */
describe( 'RenderWork', () => {

	const info = ( programs, textures ) => ( { memory: { programs, textures } } );

	it( 'says nothing about a frame that built nothing', () => {

		const memory = info( 40, 120 );

		expect( new RenderWork( memory ).since() ).toBe( null );

	} );

	it( 'names the programs linked and the maps uploaded', () => {

		const memory = info( 40, 120 );
		const work = new RenderWork( memory );

		memory.memory.programs = 43;
		memory.memory.textures = 132;

		expect( work.since() ).toBe( '3 shaders linked, 12 textures uploaded' );
		expect( work.since() ).toBe( null );

	} );

	it( 'counts one of a thing in the singular and reports a release as nothing', () => {

		const memory = info( 40, 120 );
		const work = new RenderWork( memory );

		memory.memory.programs = 41;
		expect( work.since() ).toBe( '1 shader linked' );

		memory.memory.textures = 60;
		expect( work.since() ).toBe( null );

	} );

} );
