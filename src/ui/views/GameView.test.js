// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { stubCanvas } from '../test-helpers/canvas.js';
import { GameView } from './GameView.js';

/** The overlay wires the dock to the host, keeps the loading surface and the front door. */
describe( 'GameView', () => {

	let view, onOpen, onClose, onLeave, onResume;

	beforeEach( () => {

		document.body.replaceChildren();
		stubCanvas();
		onOpen = vi.fn();
		onClose = vi.fn();
		onLeave = vi.fn();
		onResume = vi.fn();
		view = new GameView( { onOpen, onClose, onLeave, onResume, menu: { onContinue: vi.fn() } } );
		view.mount( document.body );

	} );

	it( 'returns to an inspection when that evidence also opens an ending', async () => {
		view.inspection.show( { title: 'A sealed note', text: 'The final evidence.' } );
		view.summary.show( { title: 'Case closed', text: 'The evidence settles the case.' } );
		await userEvent.setup().click( view.summary.done );
		expect( view.summary.element.hidden ).toBe( true );
		expect( view.inspection.element.hidden ).toBe( false );
		expect( document.activeElement ).toBe( view.inspection.done );
	} );

	it( 'opens panels from the dock that comes up under a panel, plays on from it, and opens QUESTS from the objective', async () => {

		const user = userEvent.setup();
		expect( view.dock.element.hidden ).toBe( true );
		// There is no pause bar: Escape opens the settings, and the dock comes up under them.
		expect( document.querySelector( '.hud-pause' ) ).toBeNull();
		view.open( 'SETTINGS' );
		expect( view.dock.element.hidden ).toBe( false );
		await user.click( within( view.dock.element ).getByRole( 'button', { name: 'Map' } ) );
		expect( view.map.element.hidden ).toBe( false );
		expect( view.dock.element.hidden ).toBe( false );
		const tab = within( view.dock.element ).getByRole( 'button', { name: 'Map' } );
		expect( tab.getAttribute( 'aria-current' ) ).toBe( 'page' );
		expect( onOpen ).toHaveBeenCalledWith( 'MAP' );

		await user.click( tab );
		expect( tab.getAttribute( 'aria-current' ) ).toBe( 'false' );
		expect( onClose ).toHaveBeenCalledOnce();
		expect( view.dock.element.hidden ).toBe( true );
		view.open( 'INVENTORY' );
		expect( view.inventory.element.hidden ).toBe( false );
		expect( view.dock.element.hidden ).toBe( false );
		view.close();
		expect( view.panels.current ).toBeNull();
		expect( view.dock.element.hidden ).toBe( true );

		// Play on the dock closes the panel and hands the pointer back to the game.
		view.open( 'CODEX' );
		await user.click( within( view.dock.element ).getByRole( 'button', { name: 'Play' } ) );
		expect( view.panels.current ).toBeNull();
		expect( onResume ).toHaveBeenCalledOnce();

		// The developer readouts come and go together.
		view.setDetails( false );
		expect( [ view.readout.element.hidden, view.stats.element.hidden ] ).toEqual( [ true, true ] );
		view.setDetails( true );
		expect( [ view.readout.element.hidden, view.stats.element.hidden ] ).toEqual( [ false, false ] );

		view.setPointerFree( true );
		expect( view.free.hidden ).toBe( false );
		expect( view.free.textContent ).toBe( 'Click the view to look around. Esc opens the settings.' );
		view.setPointerFree( false );
		expect( view.free.hidden ).toBe( true );

		view.setObjective( { title: 'Salt Wharf', objective: 'Check the freight ledger', state: 'active' } );
		await user.click( screen.getByRole( 'button', { name: /Open current quest: Salt Wharf/ } ) );
		expect( view.panels.current ).toBe( 'QUESTS' );
		expect( onOpen ).toHaveBeenCalledWith( 'QUESTS' );

	} );

	it( 'reports loading steps, ready and failure, then opens the game directory from the settings\' Leave with gameplay inert', async () => {

		view.step( 'laying the ground' );
		expect( screen.getByText( 'laying the ground' ) ).toBeTruthy();

		view.ready();
		expect( view.loading.hidden ).toBe( true );

		view.fail( 'no manifest' );
		expect( view.loading.hidden ).toBe( false );
		expect( screen.getByText( 'no manifest' ) ).toBeTruthy();

		view.setLibrary( { games: [ { id: 'g1', name: 'Night run', playable: true } ] } );
		// Leave stands in the settings, once; the dock carries none.
		view.open( 'SETTINGS' );
		expect( screen.getAllByRole( 'button', { name: 'Leave' } ) ).toHaveLength( 1 );
		expect( within( view.dock.element ).queryByRole( 'button', { name: 'Leave' } ) ).toBeNull();
		await userEvent.setup().click( screen.getByRole( 'button', { name: 'Leave' } ) );
		expect( view.mainMenu.element.hidden ).toBe( false );
		expect( view.gameplayElements.every( ( element ) => element.inert ) ).toBe( true );
		expect( screen.getByRole( 'heading', { name: 'Night run' } ) ).toBeTruthy();
		expect( onLeave ).toHaveBeenCalledOnce();

		view.hideMainMenu();
		expect( view.mainMenu.element.hidden ).toBe( true );
		expect( view.gameplayElements.every( ( element ) => ! element.inert ) ).toBe( true );

	} );

} );
