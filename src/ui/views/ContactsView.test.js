// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './contacts-layout.json' with { type: 'json' };
import schema from './contacts-layout.schema.json' with { type: 'json' };
import { ContactsView } from './ContactsView.js';

const CONTACTS = [
	{ id: 'npc-ada', name: 'Ada Vance', role: 'Clerk', status: 'online', activity: 'leisure', added: 'Mon 12:05', met: 'Salt Wharf', line: 'Call me if you find the ledger.', lastTalk: 'Mon 12:04' },
	{ id: 'npc-kip', name: 'Kip Marr', role: 'Dock hand', status: 'busy', activity: 'working', added: 'Mon 13:30' }
];

/** The people the player can call, laid out as the codex lays out its records. */
describe( 'ContactsView', () => {

	it( 'reads its labels from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'says there is nobody yet, then lists the contacts and reads the one picked, and calls from the card or the read-out', async () => {

		const onCall = vi.fn();
		const view = new ContactsView( { onClose: vi.fn(), onCall } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'No contacts yet' ) ).toBeTruthy();

		view.setContacts( CONTACTS );
		expect( screen.getByText( '2 contacts' ) ).toBeTruthy();
		expect( screen.getByRole( 'heading', { name: 'Ada Vance', level: 3 } ) ).toBeTruthy();
		expect( screen.getByText( 'Call me if you find the ledger.' ) ).toBeTruthy();
		expect( screen.getByText( 'Salt Wharf' ) ).toBeTruthy();
		expect( screen.getAllByText( 'Out' ).length ).toBeGreaterThan( 0 );

		const user = userEvent.setup();
		const kip = screen.getByRole( 'button', { name: 'Kip Marr' } );
		await user.click( kip );
		expect( kip.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( screen.getByRole( 'heading', { name: 'Kip Marr', level: 3 } ) ).toBeTruthy();
		expect( screen.getAllByText( 'At work' ).length ).toBeGreaterThan( 0 );
		expect( document.querySelector( '.contacts-presence-tag' ).dataset.presence ).toBe( 'busy' );

		// The read-out's call button, after the card's own.
		await user.click( screen.getAllByRole( 'button', { name: 'Call Kip Marr' } ).at( - 1 ) );
		expect( onCall ).toHaveBeenLastCalledWith( 'npc-kip' );
		await user.click( screen.getAllByRole( 'button', { name: 'Call Ada Vance' } )[ 0 ] );
		expect( onCall ).toHaveBeenLastCalledWith( 'npc-ada' );
		expect( kip.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		await user.type( screen.getByRole( 'searchbox' ), 'nobody' );
		expect( screen.getByText( 'No contact by that name' ) ).toBeTruthy();
		await user.click( screen.getByRole( 'button', { name: 'Clear search' } ) );
		expect( screen.getByText( '2 contacts' ) ).toBeTruthy();

	} );

	it( 'asks for each portrait only once the screen is shown, and shows it on the card and in the read-out', async () => {

		const portrait = vi.fn( async () => 'blob:ada' );
		const view = new ContactsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		view.setContacts( [ { ...CONTACTS[ 0 ], image: portrait }, { ...CONTACTS[ 1 ], image: async () => null } ] );
		expect( portrait ).not.toHaveBeenCalled();

		view.shown();
		await vi.waitFor( () => expect( document.querySelector( '.codex-picture' )?.getAttribute( 'src' ) ).toBe( 'blob:ada' ) );
		expect( document.querySelector( '.contacts-record .codex-record-image' ).getAttribute( 'src' ) ).toBe( 'blob:ada' );
		expect( portrait ).toHaveBeenCalledOnce();
		view.hidden();

	} );

} );
