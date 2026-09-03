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
		this.status.dataset.state = 'loading';
		this.sourceField = el( 'div' );
		this.sliceField = el( 'div' );
		this.camera = el( 'div', {
			className: 'status viewer-camera',
			textContent: 'click the viewport for camera control · Esc releases'
		} );
		this.fields = el( 'div', {}, this.sourceField, this.sliceField );

		this.element = el( 'div', { className: 'panel panel-controls' },
			el( 'h2', { className: 'panel-title', textContent: `building ${parcel}` } ),
			this.fields,
			this.status,
			this.camera
		);

	}

	setSource( source, hasInterior ) {

		this.sourceField.replaceChildren( new SelectField( {
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

		this.sliceField.replaceChildren( new SelectField( {
			label: 'slice',
			value: 'full',
			options,
			onChange: this.onSliceChange
		} ).element );

	}

	setStatus( text, state = 'loading' ) {

		this.status.textContent = text;
		this.status.dataset.state = state;

	}

	setCameraCaptured( captured, failed = false ) {

		this.camera.dataset.captured = String( captured );
		this.camera.textContent = failed
			? 'camera capture failed · click the viewport to retry'
			: captured ? 'camera captured · Esc releases' : 'click the viewport for camera control · Esc releases';

	}

}
