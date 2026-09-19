import { el } from '../components/dom.js';

/**
 * Right panel of the building viewer: how many material keys resolved against
 * the database, the full list of unresolved ones (rendered magenta in the
 * scene) and the variant names the catalog does not publish (drawn with the
 * canonical variant instead). Never hides a failure.
 */
export class MaterialReportPanel {

	constructor() {

		this.summary = el( 'div', { className: 'status', id: 'material-summary', textContent: 'resolving…' } );
		this.list = el( 'ul', { className: 'report-list', id: 'material-unresolved' } );

		this.element = el( 'div', { className: 'panel panel-results' },
			el( 'h2', { className: 'panel-title', textContent: 'materials' } ),
			this.summary,
			this.list
		);

	}

	update( { resolved, unresolved, unknownVariants } ) {

		this.summary.textContent = `${resolved.length} resolved · ${unresolved.length} unresolved · ${unknownVariants.length} unknown variants`;
		this.list.replaceChildren(
			...unresolved.map( ( key ) => el( 'li', { className: 'report-bad', textContent: key } ) ),
			...unknownVariants.map( ( name ) => el( 'li', { className: 'report-bad', textContent: `${name} (canonical variant drawn)` } ) )
		);

	}

}
