// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { CurrentObjective } from './CurrentObjective.js';

describe( 'CurrentObjective', () => {

	let objective, onOpen;

	beforeEach( () => {

		onOpen = vi.fn();
		objective = new CurrentObjective( { onOpen } );
		document.body.replaceChildren( objective.element );

	} );

	it( 'stays out of the HUD when there is no active objective', () => {

		expect( objective.element.hidden ).toBe( true );
		objective.setObjective( { title: ' ', objective: '' } );
		expect( objective.element.hidden ).toBe( true );

	} );

	it( 'shows the quest and opens its panel by keyboard', async () => {

		objective.setObjective( { title: 'Salt Wharf', objective: 'Check the freight ledger', state: 'active' } );
		const button = screen.getByRole( 'button', { name: 'Open current quest: Salt Wharf, Check the freight ledger' } );

		expect( screen.getByText( 'Current objective' ) ).toBeTruthy();
		expect( screen.getByText( 'Salt Wharf' ) ).toBeTruthy();
		button.focus();
		await userEvent.setup().keyboard( '{Enter}' );
		expect( onOpen ).toHaveBeenCalledOnce();

	} );

	it( 'marks a completed objective and clears it for null', () => {

		objective.setObjective( { title: 'Late shift', objective: 'Serve until close', state: 'done' } );
		expect( screen.getByText( 'Objective complete' ) ).toBeTruthy();
		expect( objective.element.classList.contains( 'is-done' ) ).toBe( true );

		objective.setObjective( null );
		expect( objective.element.hidden ).toBe( true );
		expect( objective.element.textContent ).toBe( '' );

	} );

} );
