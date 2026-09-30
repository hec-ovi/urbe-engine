// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { ControlsView } from './ControlsView.js';

/** The bindings table, and its empty line. */
describe( 'ControlsView', () => {

	it( 'says no bindings yet, then lists one row per action with every key', () => {

		const view = new ControlsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'no bindings yet' ) ).toBeTruthy();

		view.setBindings( [ { action: 'walk', keys: [ 'W', 'A', 'S', 'D' ] }, { action: 'interact', keys: [ 'E' ] } ] );

		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 2 );
		expect( screen.getByRole( 'row', { name: /walk/ } ).querySelectorAll( 'kbd' ) ).toHaveLength( 4 );
		expect( within( screen.getByRole( 'row', { name: /interact/ } ) ).getByText( 'E' ) ).toBeTruthy();

	} );

	it( 'filters live bindings and preserves search and selection through a host refresh', async () => {
		const view = new ControlsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		const bindings = [ { action: 'walk', category: 'Movement', keys: [ 'W', 'A', 'S', 'D' ] }, { action: 'read document', category: 'Interaction', keys: [ 'R' ] } ];
		view.setBindings( bindings );
		const user = userEvent.setup();
		await user.type( view.search, 'document' );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 1 );
		await user.click( screen.getByRole( 'button', { name: 'read document' } ) );
		expect( view.drawnKeys.get( 'R' ).classList.contains( 'is-active' ) ).toBe( true );
		view.setBindings( bindings );
		expect( view.search.value ).toBe( 'document' );
		expect( document.activeElement.textContent ).toBe( 'read document' );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 1 );
		await user.type( view.search, ' missing' );
		expect( screen.getByText( 'No matching controls' ) ).toBeTruthy();
		await user.click( screen.getByRole( 'button', { name: 'Clear filters' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Movement' } ) );
		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'row', { name: /walk/ } ) ).toBeTruthy();
	} );

} );
