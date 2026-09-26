// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar.js';

/** Seven entries labelled from the menu with their keys, clicks out by name, the active one lit. */
describe( 'TabBar', () => {

	it( 'shows the seven entries with their keys, reports a panel by name and Leave on its own, and lights the active tab', async () => {

		const onSelect = vi.fn();
		const onLeave = vi.fn();
		const bar = new TabBar( { onSelect, onLeave } );
		document.body.replaceChildren( bar.element );

		expect( screen.getAllByRole( 'button' ).map( ( b ) => b.textContent ) ).toEqual(
			[ 'JournalJ', 'MapM', 'InventoryI', 'CodexX', 'SettingsO', 'Controls?', 'Leave' ]
		);

		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: /^Codex/ } ) );
		await user.click( screen.getByRole( 'button', { name: /^Leave/ } ) );
		expect( onSelect ).toHaveBeenCalledWith( 'CODEX' );
		expect( onLeave ).toHaveBeenCalledOnce();

		bar.setActive( 'MAP' );
		const map = screen.getByRole( 'button', { name: /^Map/ } );
		expect( map.classList.contains( 'is-active' ) ).toBe( true );
		expect( map.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		bar.setActive( null );
		expect( document.querySelectorAll( '.is-active' ) ).toHaveLength( 0 );
		expect( map.getAttribute( 'aria-pressed' ) ).toBe( 'false' );

	} );

} );
