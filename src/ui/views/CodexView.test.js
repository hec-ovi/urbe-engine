// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { CodexView } from './CodexView.js';

const ENTRIES = [
	{ id: 'p1', title: 'Ada Vance', category: 'people', text: 'Runs the quay office.' },
	{ id: 'd1', title: 'Salt Wharf', category: 'places', text: 'The last working quay.' }
];

/** What the player has learned, grouped, one entry open at a time. */
describe( 'CodexView', () => {

	let view;

	beforeEach( () => {

		view = new CodexView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

	} );

	it( 'says nothing is recorded before any entry', () => {

		expect( screen.getByText( 'nothing recorded yet' ) ).toBeTruthy();

	} );

	it( 'setEntries groups by category and a click opens the entry', async () => {

		view.setEntries( ENTRIES );

		expect( screen.getByRole( 'heading', { name: 'people' } ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'places' } ) ).toBeTruthy();
		expect( screen.getByText( 'Runs the quay office.' ) ).toBeTruthy();

		const saltWharf = screen.getByRole( 'button', { name: 'Salt Wharf' } );
		await userEvent.setup().click( saltWharf );
		expect( screen.getByText( 'The last working quay.' ) ).toBeTruthy();
		expect( saltWharf.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

	} );

} );
