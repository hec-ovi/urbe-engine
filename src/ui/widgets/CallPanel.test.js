// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './call-layout.json' with { type: 'json' };
import schema from './call-layout.schema.json' with { type: 'json' };
import { CallPanel } from './CallPanel.js';

/** A phone call as the studio's call widget frames it: the line's state, the portrait head, the controls the state allows. */
describe( 'CallPanel', () => {

	it( 'reads its labels from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'rings, connects with the portrait and the time talked, and offers what each state allows', async () => {

		const onHangUp = vi.fn(), onRedial = vi.fn(), onClose = vi.fn();
		const panel = new CallPanel( { onHangUp, onRedial, onClose } );
		document.body.replaceChildren( panel.element );
		expect( panel.element.hidden ).toBe( true );

		panel.setContact( { name: 'Ada Vance', role: 'Clerk', handle: 'A. VANCE' } );
		panel.setState( { status: 'connecting', relay: 'Old Quay', signal: 0.8 } );
		panel.setVisible( true );
		expect( screen.getByRole( 'region', { name: 'Call with Ada Vance' } ) ).toBeTruthy();
		expect( screen.getByRole( 'status' ).textContent ).toBe( 'Calling' );
		expect( screen.getByText( 'Ringing. Waiting for Ada Vance to pick up.' ) ).toBeTruthy();
		const user = userEvent.setup();
		await user.click( screen.getByRole( 'button', { name: 'Cancel' } ) );
		expect( onHangUp ).toHaveBeenCalledOnce();
		expect( screen.queryByRole( 'button', { name: 'Call again' } ) ).toBeNull();
		expect( screen.getByRole( 'meter', { name: 'Signal' } ).getAttribute( 'aria-valuenow' ) ).toBe( '0' );

		panel.setContact( { name: 'Ada Vance', role: 'Clerk', handle: 'A. VANCE', portraitUrl: 'blob:ada' } );
		panel.setState( { status: 'connected', duration: '1:05' } );
		expect( screen.getByRole( 'img', { name: 'Ada Vance' } ).getAttribute( 'src' ) ).toBe( 'blob:ada' );
		expect( screen.getByText( 'SESSION 1:05' ) ).toBeTruthy();
		expect( screen.getByText( 'Old Quay' ) ).toBeTruthy();
		expect( screen.getByRole( 'meter', { name: 'Signal' } ).getAttribute( 'aria-valuenow' ) ).toBe( '83' );
		await user.click( screen.getByRole( 'button', { name: 'End call' } ) );
		expect( onHangUp ).toHaveBeenCalledTimes( 2 );

		panel.setState( { status: 'busy', line: 'I am at work.' } );
		expect( screen.getByText( 'I am at work.' ) ).toBeTruthy();

		panel.setState( { status: 'no-answer' } );
		expect( panel.element.dataset.tone ).toBe( 'error' );
		expect( screen.queryByRole( 'button', { name: 'End call' } ) ).toBeNull();
		await user.click( screen.getByRole( 'button', { name: 'Call again' } ) );
		await user.click( screen.getByRole( 'button', { name: 'Close' } ) );
		expect( onRedial ).toHaveBeenCalledOnce();
		expect( onClose ).toHaveBeenCalledOnce();

		await user.click( screen.getByRole( 'button', { name: 'Compact call' } ) );
		expect( panel.element.dataset.presentation ).toBe( 'compact' );
		expect( screen.getByRole( 'button', { name: 'Expand call' } ).getAttribute( 'aria-expanded' ) ).toBe( 'false' );

	} );

} );
