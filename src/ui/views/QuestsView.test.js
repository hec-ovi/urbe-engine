// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { QuestsView } from './QuestsView.js';

const QUESTS = [
	{ id: 'q1', title: 'Salt Wharf', text: 'Find who moved the crates.', state: 'active', steps: [ { text: 'Talk to Ada', done: true }, { text: 'Check the quay', done: false } ] },
	{ id: 'q2', title: 'Late shift', text: 'Cover the bar.', state: 'done', steps: [] }
];

/** The quest log: empty wording, the list, and the picked quest's steps. */
describe( 'QuestsView', () => {

	let view;

	beforeEach( () => {

		view = new QuestsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

	} );

	it( 'says no quest yet before any arrives', () => {

		expect( screen.getByText( 'no quest yet' ) ).toBeTruthy();

	} );

	it( 'setQuests lists them, opens the first, and marks steps done', async () => {

		view.setQuests( QUESTS );

		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();
		expect( screen.getByText( 'Talk to Ada' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( true );
		expect( screen.getByText( 'Check the quay' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( false );

		const lateShift = screen.getByRole( 'button', { name: /Late shift/ } );
		await userEvent.setup().click( lateShift );
		expect( screen.getByRole( 'heading', { name: 'Late shift' } ) ).toBeTruthy();
		expect( screen.getByText( 'Cover the bar.' ) ).toBeTruthy();
		expect( lateShift.getAttribute( 'aria-pressed' ) ).toBe( 'true' );

	} );

} );
