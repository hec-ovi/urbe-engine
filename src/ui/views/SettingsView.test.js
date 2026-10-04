// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import Ajv from 'ajv/dist/2020.js';
import layout from './settings-layout.json' with { type: 'json' };
import schema from './settings-layout.schema.json' with { type: 'json' };
import { SettingsView } from './SettingsView.js';

/** Seven fields in three tabbed sections, values in through setValues, one typed change out per edit. */
describe( 'SettingsView', () => {

	it( 'reads its fields from a layout that meets its schema', () => {

		const validate = new Ajv( { allErrors: true, strict: true } ).compile( schema );
		expect( validate( layout ), JSON.stringify( validate.errors ) ).toBe( true );
		expect( validate( { ...layout, sections: [ { ...layout.sections[ 0 ], groups: [ { code: 'A', label: 'x', fields: [ { key: 'k', label: 'k', type: 'select' } ] } ] } ] } ) ).toBe( false );

	} );

	it( 'setValues fills every field and each edit reports its key with a typed value', async () => {

		const onChange = vi.fn();
		const view = new SettingsView( { onChange, onClose: vi.fn() } );
		document.body.replaceChildren( view.element );

		view.setValues( { quality: 'ultra', fog: 0.0006, exposure: 0.024, crowd: 200, voice: 'off', voiceVolume: 0.8, details: 'on' } );
		expect( screen.getByLabelText( 'Picture quality' ).value ).toBe( 'ultra' );
		expect( screen.getByLabelText( 'Fog density' ).value ).toBe( '0.0006' );
		expect( screen.getByLabelText( 'Exposure' ).value ).toBe( '0.024' );
		expect( screen.getByLabelText( 'Crowd' ).value ).toBe( '200' );
		expect( screen.getByLabelText( 'NPC voices' ).value ).toBe( 'off' );
		expect( screen.getByLabelText( 'Voice volume' ).value ).toBe( '0.8' );
		expect( screen.getByLabelText( 'Developer details' ).value ).toBe( 'on' );
		expect( screen.getAllByRole( 'tab' ).map( ( tab ) => tab.textContent ) ).toEqual( [ '01Display', '02Voices', '03Screen' ] );
		expect( screen.getByRole( 'heading', { name: 'The city, in detail' } ) ).toBeTruthy();
		expect( screen.queryByRole( 'heading', { name: 'Listen to the people' } ) ).toBeNull();
		await userEvent.setup().click( screen.getByRole( 'tab', { name: /Voices/ } ) );
		expect( screen.getByRole( 'heading', { name: 'Listen to the people' } ) ).toBeTruthy();
		expect( screen.getByRole( 'tab', { name: /Voices/ } ).getAttribute( 'aria-selected' ) ).toBe( 'true' );

		// The details card reads out the setting under the pointer.
		fireEvent.pointerEnter( screen.getByLabelText( 'Voice volume' ).closest( '.field' ) );
		expect( view.element.querySelector( '.settings-detail-title' ).textContent ).toBe( 'Voice volume' );

		await userEvent.setup().selectOptions( screen.getByLabelText( 'Picture quality' ), 'low' );
		fireEvent.input( screen.getByLabelText( 'Fog density' ), { target: { value: '0.001' } } );
		fireEvent.change( screen.getByLabelText( 'Crowd' ), { target: { value: '350' } } );
		await userEvent.setup().selectOptions( screen.getByLabelText( 'NPC voices' ), 'on' );
		fireEvent.input( screen.getByLabelText( 'Voice volume' ), { target: { value: '0.35' } } );
		await userEvent.setup().selectOptions( screen.getByLabelText( 'Developer details' ), 'off' );

		expect( onChange ).toHaveBeenCalledWith( { key: 'quality', value: 'low' } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'fog', value: 0.001 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'crowd', value: 350 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'voice', value: 'on' } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'voiceVolume', value: 0.35 } );
		expect( onChange ).toHaveBeenCalledWith( { key: 'details', value: 'off' } );

	} );

	it( 'saves from this visit\'s card, saying how it went, and leaves from it', async () => {

		const onSave = vi.fn(), onLeave = vi.fn();
		const view = new SettingsView( { onChange: vi.fn(), onClose: vi.fn(), onSave, onLeave } );
		document.body.replaceChildren( view.element );
		const user = userEvent.setup();
		expect( view.saveStatus.textContent ).toBe( 'Keep your progress now.' );
		await user.click( screen.getByRole( 'button', { name: 'Save' } ) );
		expect( onSave ).toHaveBeenCalledOnce();
		view.setSave( 'saving' );
		expect( screen.getByRole( 'button', { name: 'Save' } ).disabled ).toBe( true );
		view.setSave( 'saved' );
		expect( view.saveStatus.textContent ).toBe( 'Saved.' );
		// Shown again, it forgets how the last save went; a game that is not saved cannot.
		view.shown();
		expect( view.saveStatus.textContent ).toBe( 'Keep your progress now.' );
		view.setSave( 'unavailable' );
		expect( screen.getByRole( 'button', { name: 'Save' } ).disabled ).toBe( true );
		expect( () => view.setSave( 'lost' ) ).toThrow( /unknown save state/ );
		await user.click( screen.getByRole( 'button', { name: 'Leave' } ) );
		expect( onLeave ).toHaveBeenCalledOnce();

	} );

} );
