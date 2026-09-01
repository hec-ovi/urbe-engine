// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TabBar } from './TabBar.js';

/** Seven entries with their keys, clicks out by name, the active one lit. */
describe( 'TabBar', () => {

	let bar, onSelect, onLeave;

	beforeEach( () => {

		onSelect = vi.fn();
		onLeave = vi.fn();
		bar = new TabBar( { onSelect, onLeave } );
		document.body.replaceChildren( bar.element );

	} );

	it( 'shows the seven entries in order, each with its key', () => {

		const labels = screen.getAllByRole( 'button' ).map( ( b ) => b.textContent );

		expect( labels ).toEqual( [ 'QUESTSJ', 'MAPM', 'INVENTORYI', 'CODEXX', 'SETTINGSO', 'CONTROLS?', 'LEAVEN' ] );

	} );

	it( 'a panel tab reports its name and LEAVE reports leaving', async () => {

		const user = userEvent.setup();

		await user.click( screen.getByRole( 'button', { name: /^CODEX/ } ) );
		await user.click( screen.getByRole( 'button', { name: /^LEAVE/ } ) );

		expect( onSelect ).toHaveBeenCalledWith( 'CODEX' );
		expect( onLeave ).toHaveBeenCalledOnce();

	} );

	it( 'setActive lights one tab and null clears it', () => {

		bar.setActive( 'MAP' );
		expect( screen.getByRole( 'button', { name: /^MAP/ } ).classList.contains( 'is-active' ) ).toBe( true );

		bar.setActive( null );
		expect( document.querySelectorAll( '.is-active' ) ).toHaveLength( 0 );

	} );

} );
