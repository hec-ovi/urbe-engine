// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './inventory-layout.json' with { type: 'json' };
import schema from './inventory-layout.schema.json' with { type: 'json' };
import shapes from './item-shapes.json' with { type: 'json' };
import shapesSchema from './item-shapes.schema.json' with { type: 'json' };
import { InventoryView } from './InventoryView.js';

const ITEMS = [
	{ id: 'key', name: 'Brass key', kind: 'key', description: 'Opens a door somewhere on the quay.', place: 'Salt Wharf' },
	{ id: 'note', name: 'Folded note', kind: 'paper', description: 'A phone number.', place: 'Bar Nadir', quantity: 2,
		quests: [ { id: 'q1', title: 'Salt Wharf', kind: 'main' }, { id: 'q2', title: 'Late shift', kind: 'side' } ] }
];

/** Named cards a page at a time, the picked item's detail, its stories main red and side yellow. */
describe( 'InventoryView', () => {

	it( 'reads its labels and grid from a layout that meets its schema', () => {

		const ajv = new Ajv( { allErrors: true, strict: true } );
		const validate = ajv.compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );
		const validShapes = ajv.compile( shapesSchema );
		expect( validShapes( shapes ), JSON.stringify( validShapes.errors ) ).toBe( true );

	} );

	it( 'shows sixteen cards, names the carried items on them, and details the one picked by click or by index', async () => {

		const onQuest = vi.fn();
		const view = new InventoryView( { onClose: vi.fn(), onQuest } );
		document.body.replaceChildren( view.element );
		expect( view.slots ).toHaveLength( 16 );
		expect( screen.getAllByText( 'nothing carried yet' ).length ).toBeGreaterThan( 0 );
		expect( screen.getByRole( 'button', { name: 'Empty slot 1' } ).disabled ).toBe( true );

		view.setItems( ITEMS );
		expect( screen.getByText( '2 items' ) ).toBeTruthy();
		expect( view.slots[ 0 ].textContent ).toContain( 'Brass key' );
		expect( screen.getByRole( 'heading', { name: 'Brass key' } ) ).toBeTruthy();

		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Folded note, ×2' } ) );
		expect( screen.getByRole( 'heading', { name: 'Folded note' } ) ).toBeTruthy();
		expect( screen.getByText( 'paper' ) ).toBeTruthy();
		expect( screen.getByText( 'A phone number.' ) ).toBeTruthy();
		expect( screen.getByText( 'Bar Nadir' ) ).toBeTruthy();
		expect( view.slots[ 1 ].getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		expect( view.slots[ 1 ].querySelector( '.inv-card-quantity' ).textContent ).toBe( '×2' );

		const main = screen.getByRole( 'button', { name: 'Main quest: Salt Wharf' } );
		expect( main.querySelector( '.quest-mark.is-main' ) ).toBeTruthy();
		expect( screen.getByRole( 'button', { name: 'Side quest: Late shift' } ).querySelector( '.quest-mark.is-side' ) ).toBeTruthy();
		await user.click( main );
		expect( onQuest ).toHaveBeenCalledExactlyOnceWith( 'q1' );

		view.select( 0 );
		expect( screen.getByRole( 'heading', { name: 'Brass key' } ) ).toBeTruthy();
		view.select( - 1 );
		expect( screen.getByRole( 'heading', { name: 'Pick an item' } ) ).toBeTruthy();

	} );

	it( 'pages through more items than one grid holds, turning to the page of the one picked', async () => {

		const view = new InventoryView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		view.setItems( Array.from( { length: 20 }, ( _, index ) => ( { id: `i${index}`, name: `Item ${index + 1}`, kind: 'device' } ) ) );
		const pages = screen.getByRole( 'navigation', { name: 'Inventory pages' } );
		expect( within( pages ).getByText( 'Page 1 of 2' ) ).toBeTruthy();
		expect( within( pages ).getByRole( 'button', { name: 'Page 1' } ).getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( within( pages ).getByRole( 'button', { name: 'Previous page' } ).disabled ).toBe( true );

		await userEvent.setup().click( within( pages ).getByRole( 'button', { name: 'Next page' } ) );
		expect( within( pages ).getByText( 'Page 2 of 2' ) ).toBeTruthy();
		expect( view.slots.filter( ( slot ) => ! slot.disabled ) ).toHaveLength( 4 );
		expect( view.slots[ 0 ].textContent ).toContain( 'Item 17' );

		view.select( 2 );
		expect( within( pages ).getByText( 'Page 1 of 2' ) ).toBeTruthy();
		expect( view.slots[ 2 ].getAttribute( 'aria-pressed' ) ).toBe( 'true' );

	} );

} );
