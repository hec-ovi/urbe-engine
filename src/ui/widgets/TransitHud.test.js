// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { TransitHud } from './TransitHud.js';

describe( 'TransitHud', () => {

	it( 'keeps empty choices cancellable, traps focus, and does not let Escape reach the game', async () => {
		const onCancel = vi.fn(), escaped = vi.fn();
		const hud = new TransitHud( { onCancel } );
		document.body.replaceChildren( hud.element );
		hud.element.addEventListener( 'keydown', escaped );
		hud.choose( [], 'destination' );
		expect( document.activeElement ).toBe( hud.cancel );
		const user = userEvent.setup();
		await user.tab();
		expect( document.activeElement ).toBe( hud.cancel );
		escaped.mockClear();
		await user.keyboard( '{Escape}' );
		expect( escaped ).not.toHaveBeenCalled();
		expect( onCancel ).toHaveBeenCalledOnce();
		hud.choose( [ { id: 'a', label: 'Market', code: 'B2', value: 2 }, { id: 'b', label: 'Wharf', value: 3 } ] );
		await user.keyboard( '{ArrowDown}' );
		expect( document.activeElement.getAttribute( 'aria-label' ) ).toBe( 'Wharf' );
		await user.keyboard( '{Home}' );
		expect( document.activeElement.getAttribute( 'aria-label' ) ).toBe( 'Market' );
		await user.click( hud.title );
		expect( document.activeElement ).toBe( hud.chooser );
		await user.tab( { shift: true } );
		expect( document.activeElement ).toBe( hud.cancel );
		await user.click( hud.title );
		await user.keyboard( '{Escape}' );
		expect( onCancel ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'offers each candidate as a focused button, sends the value picked, cancels on Escape, and shows or clears the aboard line', async () => {

		const onSelect = vi.fn();
		const onCancel = vi.fn();
		const hud = new TransitHud( { onSelect, onCancel } );
		document.body.replaceChildren( hud.element );
		const user = userEvent.setup();

		const service = { tripId: 'trip-a' };
		hud.choose( [
			{ id: 'a', label: 'Bus B2 to market, departs 21:04:10', value: service },
			{ id: 'b', label: 'Subway S1 to central, departs 21:04:20', value: { tripId: 'trip-b' } }
		] );
		expect( screen.getByRole( 'dialog', { name: 'Choose a service' } ) ).toBeTruthy();
		expect( document.activeElement ).toBe( screen.getByRole( 'button', { name: 'Bus B2 to market, departs 21:04:10' } ) );
		await user.keyboard( '{Enter}' );
		expect( onSelect ).toHaveBeenCalledWith( service );
		expect( hud.open ).toBe( false );

		hud.choose( [ { id: 'a', label: 'Cinder Terminus', value: {} } ], 'destination' );
		expect( screen.getByRole( 'dialog', { name: 'Choose a destination' } ) ).toBeTruthy();
		await user.keyboard( '{Escape}' );
		expect( onCancel ).toHaveBeenCalledOnce();
		expect( hud.open ).toBe( false );

		hud.ride( 'SUBWAY S1 · next central 21:08:00' );
		expect( screen.getByText( 'SUBWAY S1 · next central 21:08:00' ) ).toBeTruthy();
		hud.ride( null );
		expect( hud.status.hidden ).toBe( true );

	} );

} );
