// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { InventoryView } from './InventoryView.js';

const ITEMS = [
	{ id: 'key', name: 'Brass key', kind: 'tool', description: 'Opens a door somewhere on the quay.', place: 'Salt Wharf' },
	{ id: 'note', name: 'Folded note', kind: 'paper', description: 'A phone number.', place: 'Bar Nadir' }
];

/** Thirty slots, the items in them, and the detail of the one picked. */
describe( 'InventoryView', () => {

	it( 'holds thirty slots, fills them in order, and shows the item picked by click or by index', async () => {

		const view = new InventoryView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		expect( screen.getAllByRole( 'button', { name: /^slot \d+$/ } ) ).toHaveLength( 30 );
		expect( screen.getByText( 'nothing carried yet' ) ).toBeTruthy();

		view.setItems( ITEMS );
		expect( screen.getByText( '2 of 30 slots carried' ) ).toBeTruthy();

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Folded note' } ) );
		expect( screen.getByRole( 'heading', { name: 'Folded note' } ) ).toBeTruthy();
		expect( screen.getByText( 'paper' ) ).toBeTruthy();
		expect( screen.getByText( 'A phone number.' ) ).toBeTruthy();
		expect( screen.getByText( 'Bar Nadir' ) ).toBeTruthy();
		expect( view.slots[ 1 ].getAttribute( 'aria-pressed' ) ).toBe( 'true' );

		view.select( 0 );
		expect( screen.getByRole( 'heading', { name: 'Brass key' } ) ).toBeTruthy();
		view.select( 7 );
		expect( screen.getByText( 'empty slot' ) ).toBeTruthy();

	} );

} );
