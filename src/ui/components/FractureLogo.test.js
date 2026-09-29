// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/dom';
import { fractureLogo } from './FractureLogo.js';

describe( 'fractureLogo', () => {

	it( 'draws one named image in three shifted bands with a soft double, and six cuts unless told to hold still', () => {

		document.body.replaceChildren( fractureLogo(), fractureLogo( { label: 'urbe paused', glitch: false } ) );
		const [ moving, still ] = screen.getAllByRole( 'img' );
		expect( moving.getAttribute( 'aria-label' ) ).toBe( 'urbe' );
		expect( still.getAttribute( 'aria-label' ) ).toBe( 'urbe paused' );
		expect( moving.querySelectorAll( '.fracture-band' ) ).toHaveLength( 3 );
		expect( moving.querySelectorAll( '.fracture-ghost' ) ).toHaveLength( 1 );
		expect( moving.querySelectorAll( '.fracture-cut' ) ).toHaveLength( 6 );
		expect( still.querySelectorAll( '.fracture-cut' ) ).toHaveLength( 0 );
		// Every layer is the same four letters, hidden from assistive technology.
		for ( const drawing of moving.querySelectorAll( 'svg' ) ) {

			expect( drawing.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
			expect( drawing.querySelectorAll( 'path' ) ).toHaveLength( 4 );

		}
		expect( moving.classList.contains( 'is-backed' ) ).toBe( false );
		expect( fractureLogo( { backed: true } ).classList.contains( 'is-backed' ) ).toBe( true );

	} );

} );
