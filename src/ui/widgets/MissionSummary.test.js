// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MissionSummary } from './MissionSummary.js';

/** The card that closes a mission: what it says and how it goes away. */
describe( 'MissionSummary', () => {

	it( 'lays out title, outcome, text and ticked steps as a dialog focused on continue, and closes on continue or Escape', async () => {

		const onClose = vi.fn();
		const summary = new MissionSummary( { onClose } );
		document.body.replaceChildren( summary.element );

		summary.show( {
			title: 'Salt Wharf',
			text: 'The crates went inland.',
			outcome: 'failed',
			steps: [ { text: 'Talk to Ada', done: true }, { text: 'Check the quay', done: false } ]
		} );

		expect( summary.element.hidden ).toBe( false );
		expect( screen.getByRole( 'dialog', { name: 'Salt Wharf' } ) ).toBeTruthy();
		expect( screen.getByText( 'failed' ).classList.contains( 'is-failed' ) ).toBe( true );
		expect( screen.getByText( 'The crates went inland.' ) ).toBeTruthy();
		expect( screen.getByText( 'Talk to Ada' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( true );

		const user = userEvent.setup();
		const button = screen.getByRole( 'button', { name: 'continue' } );
		expect( document.activeElement ).toBe( button );
		await user.click( button );
		await user.keyboard( '{Escape}' );
		expect( onClose ).toHaveBeenCalledTimes( 2 );

	} );

} );
