// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Input } from './Input.js';

it( 'reports held and edge-triggered controls only while captured, and clears them on lost focus', async () => {

	const canvas = document.createElement( 'canvas' );
	document.body.append( canvas );
	const input = new Input( canvas );
	const user = userEvent.setup();
	try {

		await user.keyboard( '[Digit4]' );
		await user.pointer( { target: canvas, keys: '[MouseRight>]' } );
		expect( input.runMultiplier ).toBe( 1 );
		expect( input.zooming ).toBe( false );
		await user.pointer( { keys: '[/MouseRight]' } );

		input.locked = true;
		await user.keyboard( '[Digit2][ShiftLeft>][KeyC>][Space][KeyE]' );
		expect( input.runMultiplier ).toBe( 2 );
		expect( input.running ).toBe( true );
		expect( input.crouching ).toBe( true );
		expect( input.consume( 'Space' ) ).toBe( true );
		expect( input.consume( 'Space' ) ).toBe( false );
		expect( input.consume( 'KeyE' ) ).toBe( true );

		await user.pointer( { target: canvas, keys: '[MouseRight>]' } );
		expect( input.zooming ).toBe( true );
		const menu = new MouseEvent( 'contextmenu', { bubbles: true, cancelable: true } );
		canvas.dispatchEvent( menu );
		expect( menu.defaultPrevented ).toBe( true );

		window.dispatchEvent( new Event( 'blur' ) );
		expect( input.zooming ).toBe( false );
		expect( input.crouching ).toBe( false );
		expect( input.consume( 'KeyE' ) ).toBe( false );
		expect( input.runMultiplier ).toBe( 2 );

	} finally {

		input.dispose();
		canvas.remove();

	}

} );


it( 'settles denied capture and permits the next explicit click without overlapping requests', async () => {

	const canvas = document.createElement( 'canvas' );
	document.body.append( canvas );
	const input = new Input( canvas );
	let reject;
	canvas.requestPointerLock = vi.fn( () => new Promise( ( resolve, fail ) => { reject = fail; } ) );
	try {

		const first = input.requestLock();
		expect( input.requestLock() ).toBe( first );
		expect( canvas.requestPointerLock ).toHaveBeenCalledOnce();
		reject( new DOMException( 'Capture requires a new click', 'SecurityError' ) );
		await expect( first ).resolves.toBe( false );
		expect( input.locked ).toBe( false );
		canvas.requestPointerLock.mockImplementationOnce( () => {} );
		await expect( input.requestLock() ).resolves.toBe( true );
		expect( canvas.requestPointerLock ).toHaveBeenCalledTimes( 2 );
		canvas.remove();
		await expect( input.requestLock() ).resolves.toBe( false );
		expect( canvas.requestPointerLock ).toHaveBeenCalledTimes( 2 );

	} finally { input.dispose(); canvas.remove(); }

} );
