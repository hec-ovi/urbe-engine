// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { MissionSummary } from './MissionSummary.js';

/** The card that closes a mission: what it says and how it goes away. */
describe( 'MissionSummary', () => {

	let summary, onClose;

	beforeEach( () => {

		onClose = vi.fn();
		summary = new MissionSummary( { onClose } );
		document.body.replaceChildren( summary.element );

	} );

	it( 'show lays out title, outcome, text and ticked steps', () => {

		summary.show( {
			title: 'Salt Wharf',
			text: 'The crates went inland.',
			outcome: 'failed',
			steps: [ { text: 'Talk to Ada', done: true }, { text: 'Check the quay', done: false } ]
		} );

		expect( summary.element.hidden ).toBe( false );
		expect( screen.getByRole( 'heading', { name: 'Salt Wharf' } ) ).toBeTruthy();
		expect( screen.getByText( 'failed' ).classList.contains( 'is-failed' ) ).toBe( true );
		expect( screen.getByText( 'The crates went inland.' ) ).toBeTruthy();
		expect( screen.getByText( 'Talk to Ada' ).closest( 'li' ).classList.contains( 'is-done' ) ).toBe( true );

	} );

	it( 'focuses continue, and continue or Escape report the close', async () => {

		summary.show( { title: 'Late shift' } );
		const user = userEvent.setup();
		const button = screen.getByRole( 'button', { name: 'continue' } );
		expect( document.activeElement ).toBe( button );
		expect( screen.getByRole( 'dialog', { name: 'Late shift' } ) ).toBeTruthy();

		await user.click( button );
		await user.keyboard( '{Escape}' );

		expect( onClose ).toHaveBeenCalledTimes( 2 );

	} );

} );
