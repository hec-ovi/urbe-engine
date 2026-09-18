// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { PanelHost } from './PanelHost.js';

const fakeView = () => ( { element: document.createElement( 'div' ), shown: vi.fn() } );

/** One panel at a time, Esc closes, and the game hears every open and close. */
describe( 'PanelHost', () => {

	let views, onOpen, onClose, host, trigger;

	beforeEach( () => {

		vi.useFakeTimers();
		views = { A: fakeView(), B: fakeView() };
		onOpen = vi.fn();
		onClose = vi.fn();
		host = new PanelHost( { views, onOpen, onClose } );
		document.body.replaceChildren( host.element );
		trigger = document.createElement( 'button' );
		document.body.prepend( trigger );
		trigger.focus();

	} );

	afterEach( () => vi.useRealTimers() );

	it( 'opens one view at a time as a focused dialog, closes the one before it, hands focus back, and answers Escape and toggle', () => {

		expect( views.A.element.hidden ).toBe( true );
		expect( host.current ).toBeNull();

		host.open( 'A' );
		expect( views.A.element.hidden ).toBe( false );
		expect( views.A.element.inert ).toBe( false );
		expect( views.A.element.getAttribute( 'role' ) ).toBe( 'dialog' );
		expect( views.A.element.getAttribute( 'aria-label' ) ).toBe( 'A' );
		expect( document.activeElement ).toBe( views.A.element );
		expect( views.A.shown ).toHaveBeenCalledOnce();
		expect( onOpen ).toHaveBeenCalledWith( 'A' );
		expect( host.element.classList.contains( 'is-open' ) ).toBe( true );

		host.open( 'B' );
		expect( views.A.element.classList.contains( 'is-open' ) ).toBe( false );
		vi.runAllTimers();
		expect( views.A.element.hidden ).toBe( true );
		expect( views.B.element.hidden ).toBe( false );
		expect( host.current ).toBe( 'B' );

		host.close();
		expect( views.B.element.inert ).toBe( true );
		expect( views.B.element.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		vi.runAllTimers();
		expect( views.B.element.hidden ).toBe( true );
		expect( host.current ).toBeNull();
		expect( onClose ).toHaveBeenCalledOnce();
		expect( host.element.classList.contains( 'is-open' ) ).toBe( false );
		expect( document.activeElement ).toBe( trigger );

		// Escape closes the open panel, and is ignored once nothing is open.
		host.toggle( 'A' );
		expect( host.current ).toBe( 'A' );
		fireEvent.keyDown( window, { key: 'Escape' } );
		fireEvent.keyDown( window, { key: 'Escape' } );
		expect( host.current ).toBeNull();
		expect( onClose ).toHaveBeenCalledTimes( 2 );

	} );

} );
