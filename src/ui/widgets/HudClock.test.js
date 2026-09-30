// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { HudClock } from './HudClock.js';
import { InteractPrompt } from './InteractPrompt.js';

it( 'displays only supplied world time, phase and location and leaves unchanged nodes alone', () => {
	const clock = new HudClock();
	clock.update( 'Mon 21:14', 'Downtown', 'Market' ); clock.setState( 'night' );
	expect( clock.time.textContent ).toBe( '21:14' );
	expect( clock.day.textContent ).toBe( 'Mon' );
	expect( clock.location.textContent ).toBe( 'Market' );
	const text = clock.time.firstChild;
	clock.update( 'Mon 21:14', 'Downtown', 'Market' );
	expect( clock.time.firstChild ).toBe( text );
	clock.update( '21:15', 'Downtown' );
	expect( clock.day.textContent ).toBe( '' );
	expect( clock.location.hidden ).toBe( true );
} );

it( 'preserves the whole prompt and both authored action keys without rebuilding it each frame', () => {
	const prompt = new InteractPrompt();
	const text = 'E  inspect drive   R  take drive';
	prompt.update( text );
	expect( prompt.prompt.textContent ).toBe( text );
	expect( [ ...prompt.prompt.querySelectorAll( 'kbd' ) ].map( n => n.textContent ) ).toEqual( [ 'E', 'R' ] );
	const key = prompt.prompt.querySelector( 'kbd' );
	prompt.update( text );
	expect( prompt.prompt.querySelector( 'kbd' ) ).toBe( key );
	prompt.update( null );
	expect( prompt.prompt.hidden ).toBe( true );
	expect( prompt.prompt.textContent ).toBe( '' );
} );
