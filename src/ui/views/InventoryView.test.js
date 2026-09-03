// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { InventoryView } from './InventoryView.js';

const ITEMS = [
	{ id: 'key', name: 'Brass key', kind: 'tool', description: 'Opens a door somewhere on the quay.', place: 'Salt Wharf' },
	{ id: 'note', name: 'Folded note', kind: 'paper', description: 'A phone number.', place: 'Bar Nadir' }
];

/** Thirty slots, the items in them, and the detail of the one picked. */
describe( 'InventoryView', () => {

	let view;

	beforeEach( () => {

		view = new InventoryView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

	} );

	it( 'starts with thirty empty slots and says so', () => {

		expect( screen.getAllByRole( 'button', { name: /^slot \d+$/ } ) ).toHaveLength( 30 );
		expect( screen.getByText( 'nothing carried yet' ) ).toBeTruthy();
		expect( screen.getByText( 'pick a slot to see what it holds' ) ).toBeTruthy();

	} );

	it( 'setItems fills slots in order and a click shows the item', async () => {

		view.setItems( ITEMS );
		expect( screen.getByText( '2 of 30 slots carried' ) ).toBeTruthy();

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Folded note' } ) );

		expect( screen.getByRole( 'heading', { name: 'Folded note' } ) ).toBeTruthy();
		expect( screen.getByText( 'paper' ) ).toBeTruthy();
		expect( screen.getByText( 'A phone number.' ) ).toBeTruthy();
		expect( screen.getByText( 'Bar Nadir' ) ).toBeTruthy();
		expect( view.slots[ 1 ].classList.contains( 'is-selected' ) ).toBe( true );
		expect( view.slots[ 1 ].getAttribute( 'aria-pressed' ) ).toBe( 'true' );

	} );

	it( 'select by index works from the game side and an empty slot says so', () => {

		view.setItems( ITEMS );
		view.select( 0 );
		expect( screen.getByRole( 'heading', { name: 'Brass key' } ) ).toBeTruthy();

		view.select( 7 );
		expect( screen.getByText( 'empty slot' ) ).toBeTruthy();

	} );

} );
