// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../test-helpers/canvas.js';
import { GameView } from './GameView.js';

/** The overlay wires the bar to the host, keeps the loading surface and the front door. */
describe( 'GameView', () => {

	let view, onOpen, onClose, onLeave;

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();
		onOpen = vi.fn();
		onClose = vi.fn();
		onLeave = vi.fn();
		view = new GameView( { onOpen, onClose, onLeave, menu: { onContinue: vi.fn() } } );
		view.mount( document.body );

	} );

	it( 'routes tabs and names to one panel, keeps the bar up only while paused or open, and opens QUESTS from the objective', async () => {

		const user = userEvent.setup();
		expect( view.tabs.element.hidden ).toBe( true );

		// The bar is reached from the pause screen.
		view.setPaused( true );
		expect( view.tabs.element.hidden ).toBe( false );
		const tab = screen.getByRole( 'button', { name: /^MAP/ } );

		await user.click( tab );
		expect( view.map.element.hidden ).toBe( false );
		expect( tab.classList.contains( 'is-active' ) ).toBe( true );
		expect( onOpen ).toHaveBeenCalledWith( 'MAP' );

		await user.click( tab );
		expect( tab.classList.contains( 'is-active' ) ).toBe( false );
		expect( onClose ).toHaveBeenCalledOnce();

		view.setPaused( false );
		expect( view.tabs.element.hidden ).toBe( true );
		view.open( 'INVENTORY' );
		expect( view.inventory.element.hidden ).toBe( false );
		expect( view.tabs.element.hidden ).toBe( false );
		view.close();
		expect( view.panels.current ).toBeNull();
		expect( view.tabs.element.hidden ).toBe( true );

		view.setObjective( { title: 'Salt Wharf', objective: 'Check the freight ledger', state: 'active' } );
		await user.click( screen.getByRole( 'button', { name: /Open current quest: Salt Wharf/ } ) );
		expect( view.panels.current ).toBe( 'QUESTS' );
		expect( onOpen ).toHaveBeenCalledWith( 'QUESTS' );

	} );

	it( 'reports loading steps, ready and failure, then opens the game directory from Leave with gameplay inert', async () => {

		view.step( 'laying the ground' );
		expect( screen.getByText( 'laying the ground' ) ).toBeTruthy();

		view.ready();
		expect( view.loading.hidden ).toBe( true );

		view.fail( 'no manifest' );
		expect( view.loading.hidden ).toBe( false );
		expect( screen.getByText( 'no manifest' ) ).toBeTruthy();

		view.setLibrary( { games: [ { id: 'g1', name: 'Night run', playable: true } ] } );
		view.setPaused( true );
		await userEvent.setup().click( view.tabs.element.querySelector( '.is-leave' ) );
		expect( view.mainMenu.element.hidden ).toBe( false );
		expect( view.gameplayElements.every( ( element ) => element.inert ) ).toBe( true );
		expect( screen.getByRole( 'heading', { name: 'Night run' } ) ).toBeTruthy();
		expect( onLeave ).toHaveBeenCalledOnce();

		view.hideMainMenu();
		expect( view.mainMenu.element.hidden ).toBe( true );
		expect( view.gameplayElements.every( ( element ) => ! element.inert ) ).toBe( true );

	} );

} );
