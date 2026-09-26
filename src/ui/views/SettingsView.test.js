// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView.js';

/** Six fields in two sections, values in through setValues, one typed change out per edit. */
describe( 'SettingsView', () => {

	it( 'setValues fills every field and each edit reports its key with a typed value', async () => {

		const onChange = vi.fn();
		const view = new SettingsView( { onChange, onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

		view.setValues( { quality: 'ultra', fog: 0.0006, exposure: 0.024, crowd: 200, voice: 'off', voiceVolume: 0.8 } );
		expect( screen.getByLabelText( 'quality tier' ).value ).toBe( 'ultra' );
		expect( screen.getByLabelText( 'fog density' ).value ).toBe( '0.0006' );
		expect( screen.getByLabelText( 'exposure' ).value ).toBe( '0.024' );
		expect( screen.getByLabelText( 'crowd count' ).value ).toBe( '200' );
		expect( screen.getByLabelText( 'npc voices' ).value ).toBe( 'off' );
		expect( screen.getByLabelText( 'voice volume' ).value ).toBe( '0.8' );
		expect( screen.getAllByRole( 'heading' ).map( ( heading ) => heading.textContent ) ).toContain( 'voices' );

		await userEvent.setup().selectOptions( screen.getByLabelText( 'quality tier' ), 'low' );
		fireEvent.input( screen.getByLabelText( 'fog density' ), { target: { value: '0.001' } } );
		fireEvent.change( screen.getByLabelText( 'crowd count' ), { target: { value: '350' } } );
		await userEvent.setup().selectOptions( screen.getByLabelText( 'npc voices' ), 'on' );
		fireEvent.input( screen.getByLabelText( 'voice volume' ), { target: { value: '0.35' } } );

		expect( onChange ).toHaveBeenCalledWith( { key: 'quality', value: 'low' } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'fog', value: 0.001 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'crowd', value: 350 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'voice', value: 'on' } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'voiceVolume', value: 0.35 } );

	} );

} );
