// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { QuestsView } from './QuestsView.js';

const QUESTS = [
	{ id: 'q1', title: 'Salt Wharf', text: 'Find who moved the crates.', state: 'active', steps: [ { text: 'Talk to Ada', done: true }, { text: 'Check the quay', done: false } ] },
	{ id: 'q2', title: 'Late shift', text: 'Cover the bar.', state: 'done', steps: [] }
];

/** The quest log: empty wording, the list, and the picked quest's steps. */
describe( 'QuestsView', () => {

	it( 'says no quest yet, then lists quests, opens the first and marks steps done', async () => {

		const view = new QuestsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'no quest yet' ) ).toBeTruthy();

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

	it( 'reports the picked quest, badges a side job on offer, and says who, where and when a step is closed', async () => {

		const onSelect = vi.fn();
		const view = new QuestsView( { onClose: vi.fn(), onSelect } );
		document.body.replaceChildren( view.element );

		view.setQuests( [ ...QUESTS, {
			id: 'q3', title: 'Oxide Filter', text: 'Denna saved the cups.', state: 'available',
			steps: [ {
				text: 'Hear Denna out about the cups.', done: false, npcName: 'Denna Roe',
				place: { kind: 'parcel', id: 'p0', name: 'Oxide Filter' },
				availability: { available: false, reason: 'outside_window', text: 'This objective is open at another hour. Open 18:00 to 23:00.' },
				window: { label: 'during the slow hour', days: [ 0 ], startMin: 1080, endMin: 1380 }
			} ]
		} ] );
		expect( onSelect ).not.toHaveBeenCalled();

		const offered = screen.getByRole( 'button', { name: /Oxide Filter/ } );
		expect( offered.textContent ).toContain( 'available' );
		await userEvent.setup().click( offered );
		expect( onSelect ).toHaveBeenCalledWith( 'q3' );

		const step = screen.getByText( 'Hear Denna out about the cups.' ).closest( 'li' );
		expect( step.classList.contains( 'is-closed' ) ).toBe( true );
		expect( step.textContent ).toContain( 'Denna Roe - Oxide Filter' );
		expect( step.textContent ).toContain( 'This objective is open at another hour. Open 18:00 to 23:00.' );
		expect( step.textContent ).toContain( 'Open during the slow hour, 18:00 to 23:00' );

	} );

} );
