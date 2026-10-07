// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import Ajv from 'ajv/dist/2020.js';
import layout from './toast-layout.json' with { type: 'json' };
import schema from './toast-layout.schema.json' with { type: 'json' };
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

	it( 'bounds bursts to two notices and releases every expiry timer on disposal', () => {
		for ( let i = 0; i < 5; i ++ ) toast.show( { title: `Update ${i}`, text: `Message ${i}` } );
		expect( toast.element.children ).toHaveLength( 2 );
		expect( screen.queryByText( 'Message 0' ) ).toBeNull();
		expect( vi.getTimerCount() ).toBe( 4 );
		toast.element.querySelector( 'button' ).click();
		expect( vi.getTimerCount() ).toBe( 2 );
		toast.destroy();
		expect( vi.getTimerCount() ).toBe( 0 );
	} );

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

	it( 'reads its labels from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );

	} );

	it( 'announces a gain with its kind, a tile showing its icon until its picture arrives, and the kind\'s own line', async () => {

		let arrive;
		const picture = new Promise( ( done ) => { arrive = done; } );
		const notice = toast.show( { kind: 'item', title: 'Kessler Block key card', image: picture } );
		expect( notice.classList.contains( 'is-gain' ) ).toBe( true );
		expect( notice.querySelector( '.toast-kicker' ).textContent ).toBe( 'ITEM ACQUIRED' );
		expect( notice.querySelector( '.toast-text' ).textContent ).toBe( 'In your inventory.' );
		const tile = notice.querySelector( '.toast-tile' );
		expect( tile.querySelector( 'svg' ) ).toBeTruthy();
		arrive( 'blob:card' );
		await vi.waitFor( () => expect( tile.querySelector( 'img' )?.getAttribute( 'src' ) ).toBe( 'blob:card' ) );

		// A face for a new contact, a companion's notice with its own words, and no picture keeps the icon.
		const contact = toast.show( { kind: 'contact', title: 'Ada Vance', text: 'Added to your contacts.', image: Promise.resolve( null ) } );
		expect( contact.querySelector( '.toast-kicker' ).textContent ).toBe( 'NEW CONTACT' );
		expect( contact.querySelector( '.toast-text' ).textContent ).toBe( 'Added to your contacts.' );
		const companion = toast.show( { kind: 'companion', title: 'Pearl follows you.' } );
		expect( companion.querySelector( '.toast-kicker' ).textContent ).toBe( 'COMPANION' );
		expect( companion.querySelector( '.toast-text' ) ).toBeNull();
		await Promise.resolve();
		expect( contact.isConnected ).toBe( true );
		expect( toast.element.querySelector( '.toast.is-contact .toast-tile svg' ) ).toBeTruthy();

		// An update keeps its plain look.
		expect( toast.show( { title: 'Saved', text: 'Your progress is kept.' } ).classList.contains( 'is-gain' ) ).toBe( false );

	} );

	it( 'marks credits paid and received and a thing handed over with their kicker and icon', () => {

		const paid = toast.show( { kind: 'paid', title: '−18 cr paid to Tomas Wren', text: 'glass of whisky' } );
		expect( paid.classList.contains( 'is-paid' ) ).toBe( true );
		expect( paid.querySelector( '.toast-kicker' ).textContent ).toBe( 'PAID' );
		expect( paid.querySelector( '.toast-tile svg' ) ).toBeTruthy();
		const received = toast.show( { kind: 'received', title: '+56 cr pay booked' } );
		expect( received.querySelector( '.toast-kicker' ).textContent ).toBe( 'CREDITS' );
		expect( received.querySelector( '.toast-text' ) ).toBeNull();
		const given = toast.show( { kind: 'given', title: 'Beer handed to Ada Vance' } );
		expect( given.querySelector( '.toast-kicker' ).textContent ).toBe( 'HANDED OVER' );
		const icons = [ received, given ].map( ( notice ) => notice.querySelector( '.toast-tile path' ).getAttribute( 'd' ) );
		expect( icons[ 0 ] ).not.toBe( icons[ 1 ] );

	} );

} );
