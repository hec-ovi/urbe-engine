import { el } from '../components/dom.js';
import { SelectField } from '../components/SelectField.js';

/**
 * Run settings: variant, building count, backend, seed. Any change reports
 * the full next config through onChange (the app reloads into it).
 * props: { config, variants, counts, webgpuAvailable, onChange }
 */
export class ControlsPanel {

	constructor( props ) {

		this.props = props;
		const { config, variants, counts, webgpuAvailable, onChange } = props;
		const change = ( patch ) => onChange( { ...config, ...patch } );

		const variantEntry = variants.find( ( v ) => v.id === config.variant );

		const variantField = new SelectField( {
			label: 'variant',
			options: variants.map( ( v ) => ( { value: v.id, label: v.label } ) ),
			value: config.variant,
			onChange: ( value ) => {

				const next = variants.find( ( v ) => v.id === value );
				const backend = next.backends.includes( config.backend ) ? config.backend : next.backends[ 0 ];
				change( { variant: value, backend } );

			}
		} );

		const countField = new SelectField( {
			label: 'buildings',
			options: counts.map( ( c ) => ( { value: c, label: c.toLocaleString( 'en-US' ) } ) ),
			value: config.count,
			onChange: ( value ) => change( { count: Number( value ) } )
		} );

		const backendField = new SelectField( {
			label: 'backend',
			options: [
				{ value: 'webgpu', label: webgpuAvailable ? 'WebGPU' : 'WebGPU (unavailable)', disabled: ! webgpuAvailable },
				{ value: 'webgl', label: 'WebGL 2', disabled: ! variantEntry.backends.includes( 'webgl' ) }
			],
			value: config.backend,
			onChange: ( value ) => change( { backend: value } )
		} );

		const seedInput = el( 'input', {
			className: 'field-input', type: 'number', value: String( config.seed )
		} );
		seedInput.addEventListener( 'change', () => {

			const seed = parseInt( seedInput.value, 10 );
			if ( Number.isFinite( seed ) ) change( { seed } );

		} );

		this.element = el( 'div', { className: 'panel panel-controls' },
			el( 'h2', { className: 'panel-title', textContent: 'scale experiment' } ),
			variantField.element,
			countField.element,
			backendField.element,
			el( 'label', { className: 'field' },
				el( 'span', { className: 'field-label', textContent: 'seed' } ),
				seedInput
			)
		);

	}

}
