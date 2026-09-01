// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { MissionToast } from './MissionToast.js';

/** Slides in, holds, fades, and is gone without anyone dismissing it. */
describe( 'MissionToast', () => {

	let toast;

	beforeEach( () => {

		vi.useFakeTimers();
		toast = new MissionToast();
		document.body.replaceChildren( toast.element );

	} );

	afterEach( () => vi.useRealTimers() );

	it( 'show puts the title and text up, then fades it out and removes it', () => {

		toast.show( { title: 'New mission', text: 'Find who moved the crates.' } );

		const line = screen.getByText( 'Find who moved the crates.' ).parentElement;
		expect( screen.getByText( 'New mission' ) ).toBeTruthy();
		expect( line.classList.contains( 'is-in' ) ).toBe( true );

		vi.advanceTimersByTime( 3840 );
		expect( line.classList.contains( 'is-out' ) ).toBe( true );

		vi.advanceTimersByTime( 600 );
		expect( document.body.contains( line ) ).toBe( false );

	} );

} );
