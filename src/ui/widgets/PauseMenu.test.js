// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import menu from '../views/game-menu.json' with { type: 'json' };
import schema from '../views/game-menu.schema.json' with { type: 'json' };
import { PauseMenu } from './PauseMenu.js';

describe( 'PauseMenu', () => {

	let pause, onResume, onOpen, onSave, onLeave;

	beforeEach( () => {

		onResume = vi.fn();
		onOpen = vi.fn();
		onSave = vi.fn();
		onLeave = vi.fn();
		pause = new PauseMenu( { onResume, onOpen, onSave, onLeave } );
		document.body.replaceChildren( pause.element );
		pause.element.hidden = true;

	} );

	it( 'reads its labels from a menu that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( menu ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'is a slim bar of Resume, Save and Leave that says the city waits, each entry saying what it does, and focuses Resume when it opens', () => {

		pause.setVisible( true );
		const bar = screen.getByRole( 'region', { name: 'Paused' } );
		expect( within( bar ).getAllByRole( 'button' ).map( ( button ) => button.dataset.entry ) ).toEqual( [ 'resume', 'save', 'LEAVE' ] );
		// The panels live in the dock now: the bar covers none of the view with them.
		expect( within( bar ).queryByRole( 'button', { name: 'Journal' } ) ).toBeNull();
		expect( within( bar ).getByText( 'Session paused' ) ).toBeTruthy();
		expect( within( bar ).getByText( 'The city waits. Click the view or press Esc to play on.' ) ).toBeTruthy();
		const leave = screen.getByRole( 'button', { name: 'Leave' } );
		expect( leave.title ).toBe( 'Back to the main menu. A saved game saves first.' );
		expect( leave.getAttribute( 'aria-describedby' ) ).toBe( 'pause-leave-detail' );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Resume' } ) );
		leave.focus();
		pause.setVisible( true );
		expect( document.activeElement ).toBe( leave );

	} );

	it( 'reports resume, save and leave, and leaves a click beside the bar to the world', async () => {

		const user = userEvent.setup();
		pause.setVisible( true );
		await user.click( screen.getByRole( 'button', { name: 'Resume' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Leave' } ) );
		await user.click( pause.element );
		expect( onResume ).toHaveBeenCalledOnce();
		expect( onOpen ).not.toHaveBeenCalled();
		expect( onSave ).toHaveBeenCalledOnce();
		expect( onLeave ).toHaveBeenCalledOnce();

	} );

	it( 'says how saving goes, disables Save for a game that is not saved, and forgets a past result when it opens again', () => {

		const save = pause.buttons.get( 'save' );
		pause.setSave( 'unavailable' );
		expect( save.disabled ).toBe( true );
		expect( save.textContent ).toContain( 'A preview is not saved.' );
		pause.setSave( 'saving' );
		expect( save.disabled ).toBe( true );
		pause.setSave( 'saved' );
		expect( save.disabled ).toBe( false );
		expect( save.textContent ).toContain( 'Saved.' );
		expect( pause.status.textContent ).toBe( 'Saved.' );
		expect( save.title ).toBe( 'Saved.' );
		pause.setVisible( true );
		expect( save.textContent ).toContain( 'Keep your progress now.' );
		expect( screen.getByRole( 'status' ).textContent ).toBe( 'Keep your progress now.' );
		expect( () => pause.setSave( 'lost' ) ).toThrow( 'unknown save state: lost' );

	} );

} );
