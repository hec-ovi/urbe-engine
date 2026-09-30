import { el } from './dom.js';
import { keyCap } from './KeyCap.js';

/**
 * Header of every full screen: an optional eyebrow over the title, a line
 * beside it, room for the screen's own readouts (`aside`) and Close with its
 * Esc key on the right. The key that opens the screen is shown by the dock.
 * props: { title, onClose, eyebrow?, subtitle?, close? }
 */
export class PanelHeader {

	constructor( { title, onClose, eyebrow = '', subtitle = '', close = 'Close' } ) {

		this.title = el( 'h2', { className: 'panel-title', textContent: title } );
		this.eyebrow = el( 'p', { className: 'panel-eyebrow', textContent: eyebrow } );
		this.eyebrow.hidden = ! eyebrow;
		this.subtitle = el( 'p', { className: 'panel-subtitle', textContent: subtitle } );
		this.subtitle.hidden = ! subtitle;

		this.close = el( 'button', { className: 'panel-close', type: 'button' }, close, keyCap( 'Esc' ) );
		this.close.setAttribute( 'aria-label', 'close' );
		this.close.addEventListener( 'click', onClose );
		this.aside = el( 'div', { className: 'panel-header-aside' } );

		this.element = el( 'header', { className: 'panel-header' },
			el( 'div', { className: 'panel-heading' },
				el( 'div', { className: 'panel-heading-copy' }, this.eyebrow, this.title ),
				this.subtitle
			),
			el( 'span', { className: 'panel-header-spacer' } ),
			this.aside,
			this.close
		);

	}

	setTitle( text ) {

		this.title.textContent = text;

	}

	/** The small line over the title; empty hides it. */
	setEyebrow( text ) {

		if ( this.eyebrow.textContent !== text ) this.eyebrow.textContent = text;
		this.eyebrow.hidden = ! text;

	}

}
