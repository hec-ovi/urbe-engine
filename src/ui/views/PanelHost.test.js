// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/dom';
import { PanelHost } from './PanelHost.js';

const fakeView = () => ( { element: document.createElement( 'div' ), shown: vi.fn() } );

/** One panel at a time, Esc closes, and the game hears every open and close. */
describe( 'PanelHost', () => {

	let views, onOpen, onClose, host;

	beforeEach( () => {

		vi.useFakeTimers();
		views = { A: fakeView(), B: fakeView() };
		onOpen = vi.fn();
		onClose = vi.fn();
		host = new PanelHost( { views, onOpen, onClose } );
		document.body.replaceChildren( host.element );

	} );

	afterEach( () => vi.useRealTimers() );

	it( 'starts with every view hidden', () => {

		expect( views.A.element.hidden ).toBe( true );
		expect( views.B.element.hidden ).toBe( true );
		expect( host.current ).toBeNull();

	} );

	it( 'open shows that view, tells it, and reports the name', () => {

		host.open( 'A' );

		expect( views.A.element.hidden ).toBe( false );
		expect( views.A.element.classList.contains( 'is-open' ) ).toBe( true );
		expect( views.A.shown ).toHaveBeenCalledOnce();
		expect( onOpen ).toHaveBeenCalledWith( 'A' );
		expect( host.element.classList.contains( 'is-open' ) ).toBe( true );

	} );

	it( 'opening another closes the one before, after its transition', () => {

		host.open( 'A' );
		host.open( 'B' );

		expect( views.A.element.classList.contains( 'is-open' ) ).toBe( false );
		vi.runAllTimers();
		expect( views.A.element.hidden ).toBe( true );
		expect( views.B.element.hidden ).toBe( false );
		expect( host.current ).toBe( 'B' );

	} );

	it( 'close hides the open view and reports it', () => {

		host.open( 'A' );
		host.close();
		vi.runAllTimers();

		expect( views.A.element.hidden ).toBe( true );
		expect( host.current ).toBeNull();
		expect( onClose ).toHaveBeenCalledOnce();
		expect( host.element.classList.contains( 'is-open' ) ).toBe( false );

	} );

	it( 'Escape closes, and does nothing once closed', () => {

		host.open( 'A' );
		fireEvent.keyDown( window, { key: 'Escape' } );
		fireEvent.keyDown( window, { key: 'Escape' } );

		expect( host.current ).toBeNull();
		expect( onClose ).toHaveBeenCalledOnce();

	} );

	it( 'toggle opens a closed view and closes an open one', () => {

		host.toggle( 'B' );
		expect( host.current ).toBe( 'B' );
		host.toggle( 'B' );
		expect( host.current ).toBeNull();

	} );

} );
