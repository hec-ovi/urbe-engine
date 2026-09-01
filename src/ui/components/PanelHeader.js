import { el } from './dom.js';
import { icon } from './Icon.js';
import { keyCap } from './KeyCap.js';

/**
 * Title bar of every panel: the title, an optional key hint, and the Esc
 * close button on the right. props: { title, key, onClose }
 */
export class PanelHeader {

	constructor( { title, key, onClose } ) {

		this.title = el( 'h2', { className: 'panel-title', textContent: title } );

		this.close = el( 'button', { className: 'panel-close', type: 'button' },
			icon( 'close' ), keyCap( 'Esc' )
		);
		this.close.setAttribute( 'aria-label', 'close' );
		this.close.addEventListener( 'click', onClose );

		this.element = el( 'div', { className: 'panel-header' },
			this.title,
			key ? keyCap( key ) : '',
			el( 'span', { className: 'panel-header-spacer' } ),
			this.close
		);

	}

	setTitle( text ) {

		this.title.textContent = text;

	}

}
