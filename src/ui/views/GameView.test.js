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

	it( 'loading reports each step, goes away on ready and shows the failure', () => {

		view.step( 'laying the ground' );
		expect( screen.getByText( 'laying the ground' ) ).toBeTruthy();

		view.ready();
		expect( view.loading.hidden ).toBe( true );

		view.fail( 'no manifest' );
		expect( view.loading.hidden ).toBe( false );
		expect( screen.getByText( 'no manifest' ) ).toBeTruthy();

	} );

} );
