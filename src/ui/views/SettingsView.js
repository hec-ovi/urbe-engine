import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { SettingField } from '../components/SettingField.js';
import layout from './settings-layout.json' with { type: 'json' };

/**
 * The run's settings as a form, section by section as
 * [settings-layout.json](settings-layout.json) lists them. Every edit reports
 * one change; the game applies it and hands the values back through setValues.
 * props: { onChange({ key, value }), onClose }
 */
export class SettingsView {

	constructor( { onChange, onClose } ) {

		this.fields = new Map( layout.sections.flatMap( ( section ) => section.fields ).map( ( spec ) => [ spec.key, new SettingField( {
			...spec,
			options: spec.options?.map( ( value ) => ( { value, label: value } ) ),
			onChange: ( key, value ) => onChange( { key, value } )
		} ) ] ) );

		this.header = new PanelHeader( { title: layout.title, key: layout.key, onClose } );
		this.element = el( 'div', { className: 'view view-settings' },
			this.header.element,
			el( 'div', { className: 'view-body' },
				el( 'div', { className: 'view-main' }, ...layout.sections.flatMap( ( section ) => [
					el( 'h3', { className: 'section-title', textContent: section.title } ),
					el( 'div', { className: 'settings-form' }, ...section.fields.map( ( spec ) => this.fields.get( spec.key ).element ) )
				] ) )
			)
		);

	}

	/** @param values { quality, fog, exposure, crowd, voice, voiceVolume, details }; keys left out keep their field as is. */
	setValues( values ) {

		for ( const [ key, field ] of this.fields ) {

			if ( key in values ) field.setValue( values[ key ] );

		}

	}

}
