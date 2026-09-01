import { el } from './dom.js';

/** Labeled select. options: [{ value, label, disabled }]. */
export class SelectField {

	constructor( { label, options, value, onChange } ) {

		this.select = el( 'select', { className: 'field-input' } );

		for ( const option of options ) {

			this.select.append( el( 'option', {
				value: String( option.value ),
				textContent: option.label,
				disabled: option.disabled === true,
				selected: String( option.value ) === String( value )
			} ) );

		}

		this.select.addEventListener( 'change', () => onChange( this.select.value ) );

		this.element = el( 'label', { className: 'field' },
			el( 'span', { className: 'field-label', textContent: label } ),
			this.select
		);

	}

}
