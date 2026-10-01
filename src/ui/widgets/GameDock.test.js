// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { GameDock } from './GameDock.js';

/** Play and the six panels, each labelled with its key, the open one the current page, arrows moving along. */
describe( 'GameDock', () => {

	it( 'labels Play, every panel with its key and Leave, reports them by name, and marks the open one as the current page', async () => {

		const onSelect = vi.fn();
		const onPlay = vi.fn();
		const onLeave = vi.fn();
		const dock = new GameDock( { onSelect, onPlay, onLeave } );
		document.body.replaceChildren( dock.element );

		expect( screen.getAllByRole( 'button' ).map( ( b ) => b.textContent ) ).toEqual(
			[ 'Play', 'MapM', 'JournalJ', 'InventoryI', 'CodexX', 'ContactsP', 'SettingsO', 'Controls?', 'Leave' ]
		);
		expect( screen.getByRole( 'navigation', { name: 'Game panels' } ) ).toBeTruthy();

		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Codex' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Play' } ) );
		expect( onSelect ).toHaveBeenCalledExactlyOnceWith( 'CODEX' );
		expect( onPlay ).toHaveBeenCalledOnce();
		// Leave is the way back to the main menu, never a panel.
		await user.click( screen.getByRole( 'button', { name: 'Leave' } ) );
		expect( onLeave ).toHaveBeenCalledOnce();
		expect( onSelect ).toHaveBeenCalledOnce();

		dock.setActive( 'MAP' );
		const map = screen.getByRole( 'button', { name: 'Map' } );
		expect( map.getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( map.tabIndex ).toBe( 0 );
		expect( screen.getByRole( 'button', { name: 'Play' } ).getAttribute( 'aria-current' ) ).toBe( 'false' );

		dock.setActive( null );
		expect( map.getAttribute( 'aria-current' ) ).toBe( 'false' );
		expect( screen.getByRole( 'button', { name: 'Play' } ).getAttribute( 'aria-current' ) ).toBe( 'page' );

		// Arrow keys move along the dock, wrapping at the ends.
		map.focus();
		await user.keyboard( '{ArrowRight}' );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Journal' } ) );
		await user.keyboard( '{End}{ArrowRight}' );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Play' } ) );

	} );

} );
