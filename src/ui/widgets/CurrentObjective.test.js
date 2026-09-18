// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { CurrentObjective } from './CurrentObjective.js';

describe( 'CurrentObjective', () => {

	it( 'stays out of the HUD without an objective, shows and opens the active one, marks it done and clears on null', async () => {

		const onOpen = vi.fn();
		const objective = new CurrentObjective( { onOpen } );
		document.body.replaceChildren( objective.element );

		expect( objective.element.hidden ).toBe( true );
		objective.setObjective( { title: ' ', objective: '' } );
		expect( objective.element.hidden ).toBe( true );

		objective.setObjective( { title: 'Salt Wharf', objective: 'Check the freight ledger', state: 'active' } );
		expect( screen.getByText( 'Current objective' ) ).toBeTruthy();
		screen.getByRole( 'button', { name: 'Open current quest: Salt Wharf, Check the freight ledger' } ).focus();
		await userEvent.setup().keyboard( '{Enter}' );
		expect( onOpen ).toHaveBeenCalledOnce();

		objective.setObjective( { title: 'Late shift', objective: 'Serve until close', state: 'done' } );
		expect( screen.getByText( 'Objective complete' ) ).toBeTruthy();
		expect( objective.element.classList.contains( 'is-done' ) ).toBe( true );

		objective.setObjective( null );
		expect( objective.element.hidden ).toBe( true );
		expect( objective.element.textContent ).toBe( '' );

	} );

} );
