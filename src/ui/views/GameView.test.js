// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../test-helpers/canvas.js';
import { GameView } from './GameView.js';

/** The overlay wires the bar to the host and keeps the loading surface. */
describe( 'GameView', () => {

	let view, onOpen, onClose;

	beforeEach( () => {

		stubCanvas();
		onOpen = vi.fn();
		onClose = vi.fn();
		view = new GameView( { onOpen, onClose } );
		view.mount( document.body );

	} );

	it( 'a tab opens its panel and lights up; the same tab again closes it', async () => {

		const user = userEvent.setup();
		// The bar is reached from the pause screen.
		view.setPaused( true );
		const tab = screen.getByRole( 'button', { name: /^MAP/ } );

		await user.click( tab );
		expect( view.map.element.hidden ).toBe( false );
		expect( tab.classList.contains( 'is-active' ) ).toBe( true );
		expect( onOpen ).toHaveBeenCalledWith( 'MAP' );

		await user.click( tab );
		expect( tab.classList.contains( 'is-active' ) ).toBe( false );
		expect( onClose ).toHaveBeenCalledOnce();

	} );

	it( 'open and close by name reach the host', () => {

		view.open( 'INVENTORY' );
		expect( view.inventory.element.hidden ).toBe( false );
		view.open( 'CODEX' );
		expect( view.codex.element.hidden ).toBe( false );
		expect( view.panels.current ).toBe( 'CODEX' );
		view.close();
		expect( view.panels.current ).toBeNull();

	} );

	it( 'shows the current objective and opens its quest panel', async () => {

		view.setObjective( { title: 'Salt Wharf', objective: 'Check the freight ledger', state: 'active' } );
		await userEvent.setup().click( screen.getByRole( 'button', { name: /Open current quest: Salt Wharf/ } ) );

		expect( view.panels.current ).toBe( 'QUESTS' );
		expect( onOpen ).toHaveBeenCalledWith( 'QUESTS' );

	} );

	it( 'loading reports each step, goes away on ready and shows the failure', () => {

		view.step( 'laying the ground' );
		expect( screen.getByText( 'laying the ground' ) ).toBeTruthy();

		view.ready();
		expect( view.loading.hidden ).toBe( true );

		view.fail( 'no manifest' );
		expect( view.loading.hidden ).toBe( false );
		expect( screen.getByText( 'no manifest' ) ).toBeTruthy();

	} );

	it( 'opens the full game directory from Leave and exposes its data ports', async () => {

		const onLeave = vi.fn();
		const view = new GameView( { onLeave, menu: { onContinue: vi.fn() } } );
		view.mount( document.body );
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

describe( 'GameView tab bar', () => {

	it( 'is up only while paused or while a panel is open', () => {

		document.body.replaceChildren();
		stubCanvas();
		const view = new GameView( {} );
		view.mount( document.body );

		expect( view.tabs.element.hidden ).toBe( true );

		view.setPaused( true );
		expect( view.tabs.element.hidden ).toBe( false );

		view.setPaused( false );
		expect( view.tabs.element.hidden ).toBe( true );

		view.open( 'MAP' );
		expect( view.tabs.element.hidden ).toBe( false );

		view.close();
		expect( view.tabs.element.hidden ).toBe( true );

	} );

} );
