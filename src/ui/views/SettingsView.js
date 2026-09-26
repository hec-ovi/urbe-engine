import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { SettingField } from '../components/SettingField.js';

const options = ( values ) => values.map( ( value ) => ( { value, label: value } ) );
const SECTIONS = [
	{ title: 'look and load', fields: [
		{ key: 'quality', label: 'quality tier', type: 'select', options: options( [ 'low', 'medium', 'high', 'ultra' ] ) },
		{ key: 'fog', label: 'fog density', type: 'range', min: 0, max: 0.003, step: 0.0001 },
		{ key: 'exposure', label: 'exposure', type: 'number', min: 0.001, max: 1, step: 0.001 },
		{ key: 'crowd', label: 'crowd count', type: 'number', min: 0, max: 2000, step: 10 }
	] },
	{ title: 'voices', fields: [
		{ key: 'voice', label: 'npc voices', type: 'select', options: options( [ 'on', 'off' ] ) },
		{ key: 'voiceVolume', label: 'voice volume', type: 'range', min: 0, max: 1, step: 0.05 }
	] }
];

/**
 * The run's settings as a form. Every edit reports one change; the game
 * applies it and hands the values back through setValues.
 * props: { onChange({ key, value }), onClose }
 */
export class SettingsView {

	constructor( { onChange, onClose } ) {

		this.fields = new Map( SECTIONS.flatMap( ( section ) => section.fields ).map( ( spec ) => [ spec.key, new SettingField( {
			...spec,
			onChange: ( key, value ) => onChange( { key, value } )
		} ) ] ) );

		this.header = new PanelHeader( { title: 'Settings', key: 'O', onClose } );
		this.element = el( 'div', { className: 'view view-settings' },
			this.header.element,
			el( 'div', { className: 'view-body' },
				el( 'div', { className: 'view-main' }, ...SECTIONS.flatMap( ( section ) => [
					el( 'h3', { className: 'section-title', textContent: section.title } ),
					el( 'div', { className: 'settings-form' }, ...section.fields.map( ( spec ) => this.fields.get( spec.key ).element ) )
				] ) )
			)
		);

	}

	/** @param values { quality, fog, exposure, crowd, voice, voiceVolume }; keys left out keep their field as is. */
	setValues( values ) {

		for ( const [ key, field ] of this.fields ) {

			if ( key in values ) field.setValue( values[ key ] );

		}

	}

}
