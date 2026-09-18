// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/dom';
import { ControlsView } from './ControlsView.js';

/** The bindings table, and its empty line. */
describe( 'ControlsView', () => {

	it( 'says no bindings yet, then lists one row per action with every key', () => {

		const view = new ControlsView( { onClose: vi.fn() } );
		document.body.replaceChildren( view.element );
		expect( screen.getByText( 'no bindings yet' ) ).toBeTruthy();

		view.setBindings( [ { action: 'walk', keys: [ 'W', 'A', 'S', 'D' ] }, { action: 'interact', keys: [ 'E' ] } ] );

		expect( screen.getAllByRole( 'row' ) ).toHaveLength( 2 );
		expect( screen.getByRole( 'row', { name: /walk/ } ).querySelectorAll( 'kbd' ) ).toHaveLength( 4 );
		expect( screen.getByText( 'E' ) ).toBeTruthy();

	} );

} );
