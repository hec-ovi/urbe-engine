import '../components/styles.css';
import { el } from '../components/dom.js';
import { BuildingControlsPanel } from '../widgets/BuildingControlsPanel.js';
import { MaterialReportPanel } from '../widgets/MaterialReportPanel.js';

/**
 * Overlay for the building viewer: controls left, material report right,
 * fatal problems as a centred message.
 * props: { parcel, onSourceChange, onSliceChange }
 */
export class BuildingView {

	constructor( { parcel, onSourceChange, onSliceChange } ) {

		this.controls = new BuildingControlsPanel( { parcel, onSourceChange, onSliceChange } );
		this.report = new MaterialReportPanel();

		this.element = el( 'div', { className: 'overlay' },
			this.controls.element,
			this.report.element
		);

	}

	mount( parent ) {

		parent.append( this.element );

	}

	setSource( source, hasInterior ) {

		this.controls.setSource( source, hasInterior );

	}

	setFloorOptions( options ) {

		this.controls.setFloorOptions( options );

	}

	setReport( report ) {

		this.report.update( report );

	}

	setStatus( text ) {

		this.controls.setStatus( text );

	}

	showError( message ) {

		this.element.append( el( 'div', { className: 'error-box', textContent: message } ) );

	}

}
