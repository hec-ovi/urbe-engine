// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { VideoCallPanel } from './VideoCallPanel.js';

/** A stream in the frame, a name under it, hang up out. */
describe( 'VideoCallPanel', () => {

	let panel, onHangUp;

	beforeEach( () => {

		onHangUp = vi.fn();
		panel = new VideoCallPanel( { onHangUp } );
		document.body.replaceChildren( panel.element );
		panel.setVisible( true );

	} );

	it( 'setStream puts the element on screen and setName labels it', () => {

		expect( screen.getByText( 'connecting' ) ).toBeTruthy();

		const video = document.createElement( 'video' );
		panel.setStream( video );
		panel.setName( 'Ada Vance' );

		expect( panel.screen.firstChild ).toBe( video );
		expect( screen.getByText( 'Ada Vance' ) ).toBeTruthy();

	} );

	it( 'hang up reports it', async () => {

		await userEvent.setup().click( screen.getByRole( 'button', { name: 'hang up' } ) );
		expect( onHangUp ).toHaveBeenCalledOnce();

	} );

} );
