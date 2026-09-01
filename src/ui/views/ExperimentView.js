import '../components/styles.css';
import { el } from '../components/dom.js';
import { ControlsPanel } from '../widgets/ControlsPanel.js';
import { ResultsPanel } from '../widgets/ResultsPanel.js';
import { VARIANTS } from '../../variants/createVariant.js';
import { COUNTS } from '../../app/RunConfig.js';

/**
 * Overlay for the scale experiment: controls on the left, live results and
 * the JSON export on the right, fatal problems as a centred message.
 * props: { config, webgpuAvailable, onConfigChange, onCopyJson }
 */
export class ExperimentView {

	constructor( { config, webgpuAvailable, onConfigChange, onCopyJson } ) {

		this.controls = new ControlsPanel( {
			config,
			variants: VARIANTS,
			counts: COUNTS,
			webgpuAvailable,
			onChange: onConfigChange
		} );

		this.results = new ResultsPanel( { onCopyJson } );

		this.element = el( 'div', { className: 'overlay' },
			this.controls.element,
			this.results.element
		);

	}

	mount( parent ) {

		parent.append( this.element );

	}

	updateResults( snapshot ) {

		this.results.update( snapshot );

	}

	setStatus( text ) {

		this.results.setStatus( text );

	}

	showError( message ) {

		this.element.append( el( 'div', { className: 'error-box', textContent: message } ) );

	}

}
