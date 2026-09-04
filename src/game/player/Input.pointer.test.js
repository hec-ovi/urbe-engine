// @vitest-environment jsdom
import { expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Input } from './Input.js';

it( 'limits inspection controls to captured play and clears zoom on lost focus', async () => {

	const canvas = document.createElement( 'canvas' );
	document.body.append( canvas );
	const input = new Input( canvas );
	const user = userEvent.setup();
	try {

		await user.keyboard( '4' );
		await user.pointer( { target: canvas, keys: '[MouseRight>]' } );
		expect( input.runMultiplier ).toBe( 1 );
		expect( input.zooming ).toBe( false );
		await user.pointer( { keys: '[/MouseRight]' } );
		input.locked = true;
		await user.keyboard( '2' );
		expect( input.runMultiplier ).toBe( 2 );
		await user.pointer( { target: canvas, keys: '[MouseRight>]' } );
		expect( input.zooming ).toBe( true );
		const menu = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
		canvas.dispatchEvent( menu );
		expect( menu.defaultPrevented ).toBe( true );
		window.dispatchEvent( new Event( 'blur' ) );
		expect( input.zooming ).toBe( false );
		expect( input.runMultiplier ).toBe( 2 );

	} finally {

		input.dispose();
		canvas.remove();

	}

} );
