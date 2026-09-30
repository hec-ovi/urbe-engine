// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './codex-layout.json' with { type: 'json' };
import schema from './codex-layout.schema.json' with { type: 'json' };
import { CodexView } from './CodexView.js';

const ENTRIES = [
	{ id: 'i1', title: 'Brass key', category: 'items', text: 'Opens a door on the quay.', facts: [ { label: 'Kind', value: 'key' } ] },
	{ id: 'p1', title: 'Ada Vance', category: 'people', text: 'Runs the quay office.\n\nShe keeps the ledger.', facts: [ { label: 'Role', value: 'clerk' } ],
		related: [ { quest: 'q1', title: 'Salt Wharf', kind: 'main' }, { entry: 'd1', label: 'Met at', title: 'Salt Wharf' } ] },
	{ id: 'p2', title: 'Denna Roe', category: 'people', text: 'Pours at the Oxide Filter.' },
	{ id: 'd1', title: 'Salt Wharf', category: 'places', text: 'The last working quay.' }
];

/** What the player has come across, one category at a time, one record open. */
describe( 'CodexView', () => {

	it( 'reads its labels and categories from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'says nothing is recorded, then shows one category at a time with its count and opens the record picked', async () => {

		const onQuest = vi.fn();
		const view = new CodexView( { onClose: vi.fn(), onQuest } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'nothing recorded yet' ) ).toBeTruthy();
		expect( screen.getAllByRole( 'button', { pressed: false } ).map( ( tab ) => tab.textContent ) ).toEqual( [ 'People0', 'Places0' ] );

		view.setEntries( ENTRIES );
		const tabs = within( screen.getByRole( 'navigation', { name: 'Codex categories' } ) );
		expect( tabs.getAllByRole( 'button' ).map( ( tab ) => tab.textContent ) ).toEqual( [ 'Items1', 'People2', 'Places1' ] );
		expect( screen.getByRole( 'heading', { name: 'Brass key', level: 3 } ) ).toBeTruthy();
		expect( screen.queryByRole( 'button', { name: 'Ada Vance' } ) ).toBeNull();

		const user = userEvent.setup();
		await user.click( tabs.getByRole( 'button', { name: /People/ } ) );
		expect( screen.getByText( '2 entries' ) ).toBeTruthy();
		const denna = screen.getByRole( 'button', { name: 'Denna Roe' } );
		await user.click( denna );
		expect( denna.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( screen.getAllByText( 'Pours at the Oxide Filter.' ).length ).toBeGreaterThan( 0 );

		// A search narrows the category; a record's story opens the journal, a related record its own category.
		await user.type( screen.getByRole( 'searchbox' ), 'ledger' );
		expect( screen.getByText( '1 of 2 entries' ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Ada Vance', level: 3 } ) ).toBeTruthy();
		expect( [ ...document.querySelectorAll( '.codex-prose p' ) ].map( ( p ) => p.textContent ) ).toEqual( [ 'Runs the quay office.', 'She keeps the ledger.' ] );
		await user.click( screen.getByRole( 'button', { name: /Main quest\s*Salt Wharf/ } ) );
		expect( onQuest ).toHaveBeenCalledExactlyOnceWith( 'q1' );
		await user.click( screen.getByRole( 'button', { name: /Met at\s*Salt Wharf/ } ) );
		expect( tabs.getByRole( 'button', { name: /Places/ } ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf', level: 3 } ) ).toBeTruthy();

		// An entry of another category gets a view of its own.
		view.setEntries( [ ...ENTRIES, { id: 'n1', title: 'Night shift', category: 'rumours', text: 'Somebody saw lights.' } ] );
		expect( tabs.getAllByRole( 'button' ).map( ( tab ) => tab.textContent ) ).toEqual( [ 'Items1', 'People2', 'Places1', 'rumours1' ] );

	} );

} );
