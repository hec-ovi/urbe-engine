import { el } from '../components/dom.js';
import { prose } from '../components/Prose.js';
import { icon } from '../components/Icon.js';
import '../components/inspection.css';

/** A successful read or inspection, kept open until the player finishes reading. */
export class InspectionCard {
	constructor( { onOpen = () => {}, onClose = () => {} } = {} ) {
		this.onOpen = onOpen;
		const close = pointer => { this.setVisible( false ); onClose( { pointer } ); };
		this.title = el( 'h2', { className: 'inspection-title' } );
		this.text = el( 'div', { className: 'inspection-text' } );
		this.close = el( 'button', { type: 'button', className: 'inspection-close', ariaLabel: 'Close inspection', textContent: '×' } );
		this.done = el( 'button', { type: 'button', className: 'hud-button inspection-done', textContent: 'Return to the city' } );
		this.close.addEventListener( 'click', () => close( true ) );
		this.done.addEventListener( 'click', () => close( true ) );
		this.element = el( 'div', { className: 'inspection-layer', role: 'dialog', ariaModal: 'true', tabIndex: -1 },
			el( 'section', { className: 'inspection-card' },
				el( 'header', { className: 'inspection-header' }, el( 'div', {}, el( 'span', { className: 'inspection-kicker', textContent: 'INSPECTION' } ), this.title ), this.close ),
				el( 'div', { className: 'inspection-body' }, el( 'div', { className: 'inspection-art', ariaHidden: 'true' }, icon( 'codex' ) ), this.text ),
				el( 'footer', { className: 'inspection-footer' }, this.done, el( 'span', { textContent: 'ESC / CLOSE' } ) ) ) );
		this.element.hidden = true;
		this.element.addEventListener( 'keydown', event => {
			if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); close( false ); }
			if ( event.key !== 'Tab' ) return;
			if ( event.shiftKey && [ this.close, this.element ].includes( document.activeElement ) ) { event.preventDefault(); this.done.focus(); }
			else if ( ! event.shiftKey && [ this.done, this.element ].includes( document.activeElement ) ) { event.preventDefault(); this.close.focus(); }
		} );
	}
	show( { title, text } ) {
		this.title.textContent = title;
		this.text.replaceChildren( ...prose( text ) );
		this.element.setAttribute( 'aria-label', title );
		this.element.hidden = false;
		this.onOpen();
		this.done.focus();
	}
	setVisible( visible ) { this.element.hidden = ! visible; }
}
