// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TransitHud } from './TransitHud.js';

describe( 'TransitHud', () => {

	let hud, onSelect, onCancel;

	beforeEach( () => {

		onSelect = vi.fn();
		onCancel = vi.fn();
		hud = new TransitHud( { onSelect, onCancel } );
		document.body.replaceChildren( hud.element );

	} );

	it( 'offers every boarding service as a named keyboard-accessible button', async () => {

		const service = { tripId: 'trip-a' };
		hud.choose( [
			{ id: 'a', label: 'Bus B2 to market, departs 21:04:10', value: service },
			{ id: 'b', label: 'Subway S1 to central, departs 21:04:20', value: { tripId: 'trip-b' } }
		] );

		expect( screen.getByRole( 'dialog', { name: 'Choose a service' } ) ).toBeTruthy();
		const choice = screen.getByRole( 'button', { name: 'Bus B2 to market, departs 21:04:10' } );
		expect( document.activeElement ).toBe( choice );
		await userEvent.setup().keyboard( '{Enter}' );
		expect( onSelect ).toHaveBeenCalledWith( service );
		expect( hud.open ).toBe( false );

	} );

	it( 'cancels with Escape and shows or clears the aboard line', async () => {

		hud.choose( [ { id: 'a', label: 'Train T1', value: {} } ] );
		await userEvent.setup().keyboard( '{Escape}' );
		expect( onCancel ).toHaveBeenCalledOnce();
		expect( hud.open ).toBe( false );

		hud.ride( 'SUBWAY S1 · next central 21:08:00' );
		expect( screen.getByText( 'SUBWAY S1 · next central 21:08:00' ) ).toBeTruthy();
		hud.ride( null );
		expect( hud.status.hidden ).toBe( true );

	} );

} );
