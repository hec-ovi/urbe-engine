import { el } from './dom.js';

/**
 * One labelled form field. props: { key, label, hint?, type: 'select' | 'range' |
 * 'number', options: [{ value, label }], min, max, step, onChange }.
 * Numbers are parsed before onChange( key, value ) fires. A `hint` sits
 * under the label, the two in a `.field-copy`; a range also carries how far
 * along it stands as `--field-fill`, and its value in a readout.
 */
export class SettingField {

	constructor( { key, label, hint = '', type, options = [], min, max, step, onChange } ) {

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

			this.#show( this.input.value );
			onChange( key, type === 'select' ? this.input.value : Number( this.input.value ) );

		} );

		const caption = el( 'label', { className: 'field-label', textContent: label, htmlFor: this.input.id } );
		this.element = el( 'div', { className: 'field' },
			hint ? el( 'div', { className: 'field-copy' }, caption, el( 'span', { className: 'field-hint', textContent: hint } ) ) : caption,
			this.input,
			type === 'range' ? this.readout : ''
		);

	}

	setValue( value ) {

		this.input.value = String( value );
		this.#show( String( value ) );

	}

	#show( value ) {

		this.readout.textContent = value;
		if ( this.type !== 'range' ) return;
		const min = Number( this.input.min || 0 ), max = Number( this.input.max || 100 );
		const fill = max > min ? ( Number( value ) - min ) / ( max - min ) : 0;
		this.input.style.setProperty( '--field-fill', `${Math.round( Math.min( 1, Math.max( 0, fill ) ) * 100 )}%` );

	}

}
