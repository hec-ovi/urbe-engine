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

	it( 'names the programs linked and maps uploaded, and stays quiet about a frame that built nothing', () => {

		const memory = { memory: { programs: 40, textures: 120 } };
		const work = new RenderWork( memory );

		expect( work.since() ).toBe( null );

		memory.memory.programs = 43;
		memory.memory.textures = 132;
		expect( work.since() ).toBe( '3 shaders linked, 12 textures uploaded' );
		expect( work.since() ).toBe( null );

		memory.memory.programs = 44;
		expect( work.since() ).toBe( '1 shader linked' );

		memory.memory.textures = 60;
		expect( work.since() ).toBe( null );

	} );

} );
