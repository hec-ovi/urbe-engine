// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/dom';
import { AvatarCard } from './AvatarCard.js';

/** Portrait, name and bar, from a URL, from a canvas the game draws, or neither. */
describe( 'AvatarCard', () => {

	it( 'is hidden until setAvatar, then shows the portrait or canvas with the name and the lit bar', () => {

		const card = new AvatarCard();
		document.body.replaceChildren( card.element );
		expect( card.element.hidden ).toBe( true );

		card.setAvatar( { name: 'Ada Vance', portraitUrl: '/portraits/ada.png', bar: 0.5 } );
		expect( card.element.hidden ).toBe( false );
		expect( screen.getByRole( 'img', { name: 'Ada Vance' } ).getAttribute( 'src' ) ).toBe( '/portraits/ada.png' );
		expect( screen.getByText( 'Ada Vance' ) ).toBeTruthy();
		expect( document.querySelectorAll( '.avatar-bar-segment.is-lit' ) ).toHaveLength( 6 );

		const canvas = document.createElement( 'canvas' );
		card.setAvatar( { name: 'Ada Vance', canvas, bar: 1 } );
		expect( card.frame.firstChild ).toBe( canvas );
		expect( document.querySelectorAll( '.avatar-bar-segment.is-lit' ) ).toHaveLength( 12 );

		card.setAvatar( { name: 'Ada Vance', bar: 1 } );
		expect( card.frame.hidden ).toBe( true );
		expect( screen.getByText( 'Ada Vance' ) ).toBeTruthy();

	} );

} );
