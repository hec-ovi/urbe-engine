// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './summary-layout.json' with { type: 'json' };
import schema from './summary-layout.schema.json' with { type: 'json' };
import { MissionSummary } from './MissionSummary.js';

/** The card that closes a mission: what it says and how it goes away. */
describe( 'MissionSummary', () => {

	it( 'reads its labels from a layout that meets its schema, and shows a kind it lacks as an outcome', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

		const summary = new MissionSummary( { onClose: vi.fn() } );
		document.body.replaceChildren( summary.element );
		summary.show( { kind: 'epilogue', title: 'Salt Wharf', text: 'The crates went inland.' } );
		expect( screen.getByRole( 'button', { name: layout.kinds.outcome.action } ) ).toBeTruthy();

	} );

	it( 'keeps epilogue clicks inside the dialog for Escape and keyboard navigation', async () => {

		const onClose = vi.fn();
		const summary = new MissionSummary( { onClose } );
		document.body.replaceChildren( summary.element );
		summary.show( { title: 'Salt Wharf', text: 'The crates went inland.' } );
		const text = screen.getByText( 'The crates went inland.' );
		const user = userEvent.setup();
		await user.click( text );
		expect( document.activeElement ).toBe( summary.element );
		await user.tab();
		expect( document.activeElement ).toBe( summary.header.close );
		await user.click( text );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( summary.done );
		await user.click( text );
		await user.keyboard( '{Escape}' );
		expect( onClose ).toHaveBeenCalledExactlyOnceWith( { pointer: false } );

	} );

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
		await user.click( summary.header.close );
		await user.keyboard( '{Escape}' );
		// A click may take the pointer back at once; Escape leaves it free.
		expect( onClose.mock.calls ).toEqual( [ [ { pointer: true } ], [ { pointer: true } ], [ { pointer: false } ] ] );

	} );

	it( 'opens a prologue under its own line, a paragraph per blank line, focused on Begin and skipped by Escape', async () => {

		const onClose = vi.fn();
		const onOpen = vi.fn();
		const summary = new MissionSummary( { onClose, onOpen } );
		document.body.replaceChildren( summary.element );

		summary.show( { kind: 'prologue', title: 'Salt Wharf', text: 'You work the quay.\n\nAda Vance has a ledger for you.' } );

		expect( screen.getByRole( 'dialog', { name: 'Salt Wharf' } ) ).toBeTruthy();
		expect( screen.getByText( 'Prologue' ) ).toBeTruthy();
		expect( summary.element.querySelector( '.badge' ) ).toBeNull();
		expect( [ ...summary.text.querySelectorAll( 'p' ) ].map( ( p ) => p.textContent ) ).toEqual( [ 'You work the quay.', 'Ada Vance has a ledger for you.' ] );
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Begin' } ) );
		expect( onOpen ).toHaveBeenCalledOnce();

		await userEvent.setup().keyboard( '{Escape}' );
		expect( onClose ).toHaveBeenCalledExactlyOnceWith( { pointer: false } );

		summary.show( { title: 'Salt Wharf', text: 'The crates went inland.' } );
		expect( screen.getByRole( 'button', { name: 'continue' } ) ).toBeTruthy();
		expect( screen.queryByText( 'Prologue' ) ).toBeNull();

	} );

} );
