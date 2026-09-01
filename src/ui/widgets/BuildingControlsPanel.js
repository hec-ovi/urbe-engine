import { el } from '../components/dom.js';
import { SelectField } from '../components/SelectField.js';

/**
 * Left panel of the building viewer: parcel name, GLB source and floor slice.
 * props: { parcel, onSourceChange, onSliceChange }
 */
export class BuildingControlsPanel {

	constructor( { parcel, onSourceChange, onSliceChange } ) {

		this.onSourceChange = onSourceChange;
		this.onSliceChange = onSliceChange;

		this.status = el( 'div', { className: 'status', id: 'viewer-status', textContent: 'loading…' } );
		this.fields = el( 'div' );

		this.element = el( 'div', { className: 'panel panel-controls' },
			el( 'h2', { className: 'panel-title', textContent: `building ${parcel}` } ),
			this.fields,
			this.status
		);

	}

	setSource( source, hasInterior ) {

		this.fields.append( new SelectField( {
			label: 'source',
			value: source,
			options: [
				{ value: 'shell', label: 'exterior shell' },
				{ value: 'interior', label: 'with interior', disabled: ! hasInterior }
			],
			onChange: this.onSourceChange
		} ).element );

	}

	setFloorOptions( options ) {

		this.fields.append( new SelectField( {
			label: 'slice',
			value: 'full',
			options,
			onChange: this.onSliceChange
		} ).element );

	}

	setStatus( text ) {

		this.status.textContent = text;

	}

}
