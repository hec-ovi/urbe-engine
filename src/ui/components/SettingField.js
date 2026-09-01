import { el } from './dom.js';

/**
 * One labelled form field. props: { key, label, type: 'select' | 'range' |
 * 'number', options: [{ value, label }], min, max, step, onChange }.
 * Numbers are parsed before onChange( key, value ) fires.
 */
export class SettingField {

	constructor( { key, label, type, options = [], min, max, step, onChange } ) {

		this.key = key;
		this.type = type;

		if ( type === 'select' ) {

			this.input = el( 'select', { className: 'field-input' },
				...options.map( ( option ) => el( 'option', { value: option.value, textContent: option.label } ) )
			);

		} else {

			this.input = el( 'input', { className: 'field-input', type } );
			if ( min !== undefined ) this.input.min = String( min );
			if ( max !== undefined ) this.input.max = String( max );
			if ( step !== undefined ) this.input.step = String( step );

		}

		this.input.id = `setting-${key}`;
		this.readout = el( 'output', { className: 'field-readout' } );
		this.readout.htmlFor = this.input.id;

		this.input.addEventListener( type === 'range' ? 'input' : 'change', () => {

			this.readout.textContent = this.input.value;
			onChange( key, type === 'select' ? this.input.value : Number( this.input.value ) );

		} );

		this.element = el( 'div', { className: 'field' },
			el( 'label', { className: 'field-label', textContent: label, htmlFor: this.input.id } ),
			this.input,
			type === 'range' ? this.readout : ''
		);

	}

	setValue( value ) {

		this.input.value = String( value );
		this.readout.textContent = String( value );

	}

}
