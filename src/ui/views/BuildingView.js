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

	constructor( { parcel, onSourceChange, onSliceChange, onRetry, onExterior } ) {

		this.controls = new BuildingControlsPanel( { parcel, onSourceChange, onSliceChange } );
		this.report = new MaterialReportPanel();
		this.onRetry = onRetry;
		this.onExterior = onExterior;
		this.issue = null;

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

	setStatus( text, state = 'loading' ) {

		this.controls.setStatus( text, state );

	}

	setCameraCaptured( captured, failed = false ) {

		this.controls.setCameraCaptured( captured, failed );

	}

	showIssue( { state = 'failed', title, message, details, exterior = false } ) {

		this.issue?.remove();
		const actions = el( 'div', { className: 'viewer-error-actions' } );
		actions.append( button( state === 'unavailable' ? 'retry generation' : 'retry', this.onRetry ) );
		if ( exterior ) actions.append( button( 'return to exterior', this.onExterior ) );
		this.issue = el( 'section', { className: 'error-box', role: 'alert' },
			el( 'h3', { textContent: title } ),
			el( 'p', { textContent: message } ),
			actions,
			details ? el( 'details', {},
				el( 'summary', { textContent: 'technical details' } ),
				el( 'pre', { textContent: details } )
			) : ''
		);
		this.issue.dataset.state = state;
		this.element.append( this.issue );

	}

	clearIssue() {

		this.issue?.remove();
		this.issue = null;

	}

}

function button( label, action ) {

	const element = el( 'button', { className: 'button', type: 'button', textContent: label } );
	element.addEventListener( 'click', () => action?.() );

	return element;

}
