// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { InteractPrompt } from './InteractPrompt.js';

it( 'marks a door with a lock shut while it is locked to the player and open once they carry its card', () => {

	const prompt = new InteractPrompt();
	prompt.update( 'Locked: apartment 1407 needs an access card', { lock: { locked: true } } );
	expect( prompt.prompt.querySelector( '.hud-prompt-lock.is-locked' ) ).toBeTruthy();
	expect( prompt.element.classList.contains( 'is-locked' ) ).toBe( true );
	expect( prompt.prompt.textContent ).toBe( 'Locked: apartment 1407 needs an access card' );

	prompt.update( 'E  open the door to apartment 1407', { lock: { locked: false } } );
	expect( prompt.prompt.querySelector( '.hud-prompt-lock.is-unlocked' ) ).toBeTruthy();
	expect( prompt.element.classList.contains( 'is-locked' ) ).toBe( false );
	expect( prompt.prompt.querySelector( '.keycap' )?.textContent ).toBe( 'E' );

	// A door with no lock, or anything else, carries no mark.
	prompt.update( 'E  open the door to BAR' );
	expect( prompt.prompt.querySelector( '.hud-prompt-lock' ) ).toBeNull();
	prompt.update( null );
	expect( prompt.prompt.hidden ).toBe( true );

} );
