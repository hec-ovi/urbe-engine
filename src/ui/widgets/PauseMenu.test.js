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

	it( 'lays out labelled sections, each entry saying what it does, and focuses Resume when it opens', () => {

		pause.setVisible( true );
		const dialog = screen.getByRole( 'dialog', { name: 'Paused' } );
		expect( [ ...dialog.querySelectorAll( 'h3' ) ].map( ( heading ) => heading.textContent ) ).toEqual( [ 'Play', 'Your story', 'Game' ] );
		const journal = screen.getByRole( 'button', { name: 'Journal' } );
		expect( journal.textContent ).toBe( 'JournalYour stories, your current goal and where it is.J' );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Resume' } ) );
		screen.getByRole( 'button', { name: 'Map' } ).focus();
		pause.setVisible( true );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Map' } ) );
		expect( within( dialog ).getByText( 'walk' ) ).toBeTruthy();

	} );

	it( 'reports resume, each panel by name, save and leave, and resumes from a click beside the menu', async () => {

		const user = userEvent.setup();
		pause.setVisible( true );
		await user.click( screen.getByRole( 'button', { name: 'Resume' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Journal' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Settings' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Leave' } ) );
		await user.click( pause.element );
		expect( onResume ).toHaveBeenCalledTimes( 2 );
		expect( onOpen.mock.calls ).toEqual( [ [ 'QUESTS' ], [ 'SETTINGS' ] ] );
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
		pause.setVisible( true );
		expect( save.textContent ).toContain( 'Keep your progress now.' );
		expect( () => pause.setSave( 'lost' ) ).toThrow( 'unknown save state: lost' );

	} );

} );
