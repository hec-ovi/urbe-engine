// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { count, stubCanvas } from '../test-helpers/canvas.js';
import { ThinkingOrb } from './ThinkingOrb.js';

const frame = () => new Promise( ( resolve ) => requestAnimationFrame( resolve ) );

describe( 'ThinkingOrb', () => {

	beforeEach( () => {

		stubCanvas();
		document.body.replaceChildren();

	} );

	it( 'hides while idle, draws a dotted shell in its text colour while it waits, and asks for frames only while one turns', async () => {

		const orb = new ThinkingOrb( { size: 30 } );
		document.body.append( orb.element );
		expect( orb.element.hidden ).toBe( true );
		expect( orb.element.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( ThinkingOrb.turning ).toBe( false );

		orb.element.style.color = 'rgb(227, 202, 125)';
		orb.setState( 'thinking' );
		expect( orb.element.hidden ).toBe( false );
		expect( ThinkingOrb.turning ).toBe( true );
		const ctx = orb.context;
		expect( ctx.calls ).toContainEqual( [ 'set', 'fillStyle', 'rgb(227, 202, 125)' ] );
		const first = count( ctx, 'fillRect' );
		expect( first ).toBeGreaterThan( 100 );
		expect( first ).toBeLessThanOrEqual( 198 );
		for ( let index = 0; index < 4; index ++ ) await frame();
		expect( count( ctx, 'fillRect' ) ).toBeGreaterThan( first );
		orb.setState( 'streaming' );

		orb.setState( 'idle' );
		expect( orb.element.hidden ).toBe( true );
		expect( ThinkingOrb.turning ).toBe( false );
		const rested = count( ctx, 'fillRect' );
		for ( let index = 0; index < 4; index ++ ) await frame();
		expect( count( ctx, 'fillRect' ) ).toBe( rested );
		expect( () => orb.setState( 'loud' ) ).toThrow( 'unknown orb state: loud' );

	} );

	it( 'stops turning once its element leaves the page', async () => {

		const orb = new ThinkingOrb();
		document.body.append( orb.element );
		orb.setState( 'speaking' );
		orb.element.remove();
		await frame();
		await frame();
		expect( ThinkingOrb.turning ).toBe( false );

	} );

} );
