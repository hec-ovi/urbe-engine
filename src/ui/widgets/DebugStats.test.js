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

	it( 'names the backend, tier and render size, counts resolved materials and hitches, and warns on every slow path', () => {

		const clean = new DebugStats();
		const warned = new DebugStats();

		clean.update( { ...sample, backend: 'webgpu', tier: 'high', gpuMs: 3.14 } );
		warned.update( { ...sample, materials: 21, unresolved: 1, hitches: 42, worstMs: 8754.6, gpuMs: null } );

		expect( clean.element.textContent ).toContain( 'webgpu' );
		expect( clean.element.textContent ).toContain( 'high' );
		expect( clean.element.textContent ).toContain( '1920x1080' );
		expect( clean.element.textContent ).toContain( '22 materials  0 unresolved' );
		expect( clean.element.textContent ).toContain( 'no hitch' );
		expect( clean.element.textContent ).toContain( 'gpu 3.14 ms' );
		expect( clean.rows.path.className ).toBe( '' );
		expect( clean.rows.materials.className ).toBe( '' );
		expect( clean.rows.hitches.className ).toBe( '' );

		expect( warned.element.textContent ).toContain( 'webgl' );
		expect( warned.element.textContent ).toContain( 'low' );
		expect( warned.element.textContent ).toContain( '42 hitches  8755 ms worst' );
		// A backend without GPU queries says so rather than reading as zero.
		expect( warned.element.textContent ).toContain( 'gpu n/a' );
		expect( warned.rows.path.className ).toBe( 'hud-stats-warn' );
		expect( warned.rows.materials.className ).toBe( 'hud-stats-warn' );
		expect( warned.rows.hitches.className ).toBe( 'hud-stats-warn' );

	} );

	it( 'writes nothing to the page on a frame whose numbers did not change', async () => {

		const stats = new DebugStats();
		document.body.append( stats.element );
		stats.update( { ...sample, hitches: 3, worstMs: 120 } );
		const records = [];
		const observer = new MutationObserver( ( list ) => records.push( ...list ) );
		observer.observe( stats.element, { subtree: true, childList: true, attributes: true, characterData: true } );

		stats.update( { ...sample, hitches: 3, worstMs: 120 } );
		await Promise.resolve();
		expect( records ).toHaveLength( 0 );

		stats.update( { ...sample, hitches: 0, worstMs: 0 } );
		await Promise.resolve();
		expect( records.some( ( record ) => record.attributeName === 'class' ) ).toBe( true );
		expect( stats.rows.hitches.className ).toBe( '' );
		observer.disconnect();
		stats.element.remove();

	} );

} );
