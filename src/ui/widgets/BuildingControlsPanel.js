import { el } from '../components/dom.js';
import { SelectField } from '../components/SelectField.js';

/**
 * Left panel of the building viewer: parcel name, GLB source and floor slice.
 * props: { parcel, brightness, onBrightnessChange, onSourceChange, onSliceChange }
 */
export class BuildingControlsPanel {

	constructor( { parcel, brightness = 1, onBrightnessChange, onSourceChange, onSliceChange, onWalk, onInspect } ) {

		this.onSourceChange = onSourceChange;
		this.onSliceChange = onSliceChange;
		this.onWalk = onWalk;
		this.onInspect = onInspect;
		this.brightness = el( 'input', { type: 'range', min: '-1', max: '5', step: '0.25' } );
		this.brightness.setAttribute( 'aria-label', 'Brightness' );
		this.brightnessValue = el( 'output' );
		const changeBrightness = value => {
			this.setBrightness( value );
			onBrightnessChange?.( value );
		};
		this.brightness.addEventListener( 'input', () => changeBrightness( 2 ** Number( this.brightness.value ) ) );
		const bright = el( 'button', { type: 'button', className: 'button', textContent: 'Bright inspection' } );
		bright.addEventListener( 'click', () => changeBrightness( 8 ) );
		const reset = el( 'button', { type: 'button', className: 'button', textContent: 'Reset light' } );
		reset.addEventListener( 'click', () => changeBrightness( 1 ) );
		this.lightField = el( 'div', { className: 'building-light-controls' },
			el( 'label', { className: 'field' },
				el( 'span', { className: 'field-label', textContent: 'Brightness' } ), this.brightness, this.brightnessValue ),
			el( 'div', { className: 'viewer-error-actions' }, bright, reset )
		);
		this.setBrightness( brightness );
		this.walkField = el( 'div' );
		this.help = el( 'p', { className: 'status', textContent: 'Inspect: WASD · Q/E down/up · Shift faster' } );
		this.prompt = el( 'div', { className: 'building-interaction', hidden: true } );
		this.crosshair = el( 'div', { className: 'building-crosshair', textContent: '+', hidden: true, 'aria-hidden': 'true' } );

		this.status = el( 'div', { className: 'status', id: 'viewer-status', textContent: 'loading…' } );
		this.status.dataset.state = 'loading';
		this.sourceField = el( 'div' );
		this.sliceField = el( 'div' );
		this.camera = el( 'div', {
			className: 'status viewer-camera',
			textContent: 'click the viewport for camera control · Esc releases'
		} );
		this.fields = el( 'div', {}, this.sourceField, this.sliceField, this.lightField, this.walkField );

		this.element = el( 'div', { className: 'panel panel-controls' },
			el( 'h2', { className: 'panel-title', textContent: `building ${parcel}` } ),
			this.fields,
			this.status,
			this.camera, this.help, this.prompt, this.crosshair
		);

	}

	setBrightness( value ) {
		this.brightness.value = String( Math.log2( value ) );
		this.brightnessValue.textContent = `${Number( value.toFixed( 1 ) )}×`;
		this.brightness.setAttribute( 'aria-valuetext', this.brightnessValue.textContent );
	}

	setWalkOptions( floors, active, inside ) {
		const destination = new SelectField( { label: 'Walk from', value: inside && floors.length ? String( floors[ 0 ].index ) : 'outside',
			options: [ { value: 'outside', label: 'Main entrance' }, ...floors.map( floor => ( { value: String( floor.index ), label: floor.label ?? `Floor ${floor.index + 1}` } ) ) ], onChange: () => {} } );
		destination.select.setAttribute( 'aria-label', 'Walk from' );
		const walk = el( 'button', { type: 'button', className: 'button', textContent: 'Walk in first person' } );
		walk.addEventListener( 'click', () => this.onWalk?.( destination.select.value === 'outside' ? null : Number( destination.select.value ) ) );
		const inspect = el( 'button', { type: 'button', className: 'button', textContent: 'Inspect exterior' } );
		inspect.addEventListener( 'click', () => this.onInspect?.() );
		this.walkField.replaceChildren( destination.element, walk, inspect );
		this.setWalkActive( active );
	}

	setWalkActive( active ) {
		this.sliceField.hidden = active;
		this.crosshair.hidden = ! active;
		this.help.textContent = active ? 'WASD walk · Shift run · Space jump · C crouch · E doors / lift · Esc release' : 'Inspect: WASD · Q/E down/up · Shift faster';
	}

	setInteraction( text ) { this.prompt.hidden = ! text; this.prompt.textContent = text ?? ''; }

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
		this.element.classList.toggle( 'building-captured', captured );

		this.camera.dataset.captured = String( captured );
		this.camera.textContent = failed
			? 'camera capture failed · click the viewport to retry'
			: captured ? 'camera captured · Esc releases' : 'click the viewport for camera control · Esc releases';

	}

}
