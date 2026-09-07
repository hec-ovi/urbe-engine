import { el } from './dom.js';
import { SettingField } from './SettingField.js';

/** JSON field layout using the shared input widgets. */
export class CreationForm {

	constructor( fields, onChange = () => {} ) {

		this.fields = fields;
		this.widgets = fields.map( ( field ) => new SettingField( { ...field, onChange } ) );
		this.inputs = Object.fromEntries( this.widgets.map( ( widget ) => [ widget.key, widget.input ] ) );
		this.element = el( 'div', { className: 'creation-form-grid' }, ...this.widgets.map( ( widget ) => widget.element ) );
		this.reset();

	}

	reset() {

		this.widgets.forEach( ( widget, index ) => widget.setValue( this.fields[ index ].value ) );

	}

}
