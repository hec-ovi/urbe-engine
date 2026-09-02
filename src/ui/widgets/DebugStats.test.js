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
		backend: 'webgl', tier: 'low', width: 1920, height: 1080
	};

	it( 'names the backend, the tier and the render size', () => {

		const stats = new DebugStats();

		stats.update( sample );

		expect( stats.element.textContent ).toContain( 'webgl' );
		expect( stats.element.textContent ).toContain( 'low' );
		expect( stats.element.textContent ).toContain( '1920x1080' );

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
