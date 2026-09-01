// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView.js';

/** Four fields, values in through setValues, one typed change out per edit. */
describe( 'SettingsView', () => {

	let view, onChange;

	beforeEach( () => {

		onChange = vi.fn();
		view = new SettingsView( { onChange, onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

	} );

	it( 'setValues fills every field it names', () => {

		view.setValues( { quality: 'ultra', fog: 0.0006, exposure: 0.024, crowd: 200 } );

		expect( screen.getByLabelText( 'quality tier' ).value ).toBe( 'ultra' );
		expect( screen.getByLabelText( 'fog density' ).value ).toBe( '0.0006' );
		expect( screen.getByLabelText( 'exposure' ).value ).toBe( '0.024' );
		expect( screen.getByLabelText( 'crowd count' ).value ).toBe( '200' );

	} );

	it( 'picking a quality tier reports it by key', async () => {

		await userEvent.setup().selectOptions( screen.getByLabelText( 'quality tier' ), 'low' );
		expect( onChange ).toHaveBeenCalledWith( { key: 'quality', value: 'low' } );

	} );

	it( 'numeric fields report numbers, not strings', () => {

		fireEvent.input( screen.getByLabelText( 'fog density' ), { target: { value: '0.001' } } );
		fireEvent.change( screen.getByLabelText( 'crowd count' ), { target: { value: '350' } } );

		expect( onChange ).toHaveBeenCalledWith( { key: 'fog', value: 0.001 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'crowd', value: 350 } );

	} );

} );
