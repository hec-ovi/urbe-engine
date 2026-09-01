import { el } from '../components/dom.js';
import { emptyState } from '../components/EmptyState.js';
import { keyCap } from '../components/KeyCap.js';
import { PanelHeader } from '../components/PanelHeader.js';

/** The key bindings, one row per action. props: { onClose } */
export class ControlsView {

	constructor( { onClose } ) {

		this.main = el( 'div', { className: 'view-main' } );
		this.header = new PanelHeader( { title: 'Controls', key: '?', onClose } );
		this.element = el( 'div', { className: 'view view-controls' },
			this.header.element,
			el( 'div', { className: 'view-body' }, this.main )
		);

		this.setBindings( [] );

	}

	/** @param bindings [{ action, keys: [string] }] */
	setBindings( bindings = [] ) {

		if ( ! bindings.length ) {

			this.main.replaceChildren( emptyState( 'no bindings yet' ) );

			return;

		}

		this.main.replaceChildren( el( 'table', { className: 'controls-table' },
			el( 'tbody', {}, ...bindings.map( ( binding ) => el( 'tr', {},
				el( 'td', { textContent: binding.action } ),
				el( 'td', {}, ...binding.keys.map( keyCap ) )
			) ) )
		) );

	}

}
