// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DebugStats } from './DebugStats.js';

/**
 * The readout is the evidence a screenshot carries: whoever looks at one has to
 * be able to say which backend and which tier drew it, at what size, without
 * asking. It also has to warn on the slow path rather than state it quietly.
 */
describe( 'DebugStats', () => {

	const sample = {
		frameMs: 11, gpuMs: 0, drawCalls: 100, triangles: 1000,
		crowd: 0, cars: 0, interiors: 0, lights: 0,
		backend: 'webgl', tier: 'low', width: 1920, height: 1080,
		materials: 22, unresolved: 0, hitches: 0, worstMs: 0
	};

	it( 'names the backend, the tier and the render size', () => {

		const stats = new DebugStats();

		stats.update( sample );

		expect( stats.element.textContent ).toContain( 'webgl' );
		expect( stats.element.textContent ).toContain( 'low' );
		expect( stats.element.textContent ).toContain( '1920x1080' );

	} );

	it( 'reports how many material keys resolved, and warns when one did not', () => {

		const clean = new DebugStats();
		const missing = new DebugStats();

		clean.update( sample );
		missing.update( { ...sample, materials: 21, unresolved: 1 } );

		expect( clean.element.textContent ).toContain( '22 materials  0 unresolved' );
		expect( clean.rows.materials.className ).toBe( '' );
		expect( missing.rows.materials.className ).toBe( 'hud-stats-warn' );

	} );

	it( 'answers whether the run stalled, and by how long', () => {

		const smooth = new DebugStats();
		const stuttering = new DebugStats();

		smooth.update( sample );
		stuttering.update( { ...sample, hitches: 42, worstMs: 8754.6 } );

		expect( smooth.element.textContent ).toContain( 'no hitch' );
		expect( smooth.rows.hitches.className ).toBe( '' );
		expect( stuttering.element.textContent ).toContain( '42 hitches  8755 ms worst' );
		expect( stuttering.rows.hitches.className ).toBe( 'hud-stats-warn' );

	} );

	it( 'marks the fallback backend and leaves the native one plain', () => {

		const webgl = new DebugStats();
		const webgpu = new DebugStats();

		webgl.update( sample );
		webgpu.update( { ...sample, backend: 'webgpu', tier: 'high' } );

		expect( webgl.rows.path.className ).toBe( 'hud-stats-warn' );
		expect( webgpu.rows.path.className ).toBe( '' );

	} );

} );
