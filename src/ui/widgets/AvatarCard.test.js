// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/dom';
import { AvatarCard } from './AvatarCard.js';

/** Portrait, name and bar, from a URL or from a canvas the game draws. */
describe( 'AvatarCard', () => {

	let card;

	beforeEach( () => {

		card = new AvatarCard();
		document.body.replaceChildren( card.element );

	} );

	it( 'is hidden until setAvatar, then shows the portrait, name and bar', () => {

		expect( card.element.hidden ).toBe( true );

		card.setAvatar( { name: 'Ada Vance', portraitUrl: '/portraits/ada.png', bar: 0.5 } );

		expect( card.element.hidden ).toBe( false );
		expect( screen.getByRole( 'img', { name: 'Ada Vance' } ).getAttribute( 'src' ) ).toBe( '/portraits/ada.png' );
		expect( screen.getByText( 'Ada Vance' ) ).toBeTruthy();
		expect( document.querySelectorAll( '.avatar-bar-segment.is-lit' ) ).toHaveLength( 6 );

	} );

	it( 'a canvas takes the portrait slot', () => {

		const canvas = document.createElement( 'canvas' );
		card.setAvatar( { name: 'Ada Vance', canvas, bar: 1 } );

		expect( card.frame.firstChild ).toBe( canvas );
		expect( document.querySelectorAll( '.avatar-bar-segment.is-lit' ) ).toHaveLength( 12 );

	} );

} );
