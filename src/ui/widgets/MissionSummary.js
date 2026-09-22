import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * The card that closes a mission: title, outcome, what happened, each step
 * ticked or not. props: { onClose() }
 */
export class MissionSummary {

	constructor( { onClose, onOpen = () => {} } ) {

		this.onOpen = onOpen;

		this.header = new PanelHeader( { title: '', onClose } );
		this.outcome = el( 'div', { className: 'detail-kind' } );
		this.text = el( 'p', { className: 'detail-text' } );
		this.steps = el( 'ul', { className: 'quest-steps' } );
		this.done = el( 'button', { className: 'hud-button is-primary', type: 'button', textContent: 'continue' } );
		this.done.addEventListener( 'click', onClose );

		this.card = el( 'div', { className: 'summary' },
			this.header.element,
			el( 'div', { className: 'summary-body' }, this.outcome, this.text, this.steps ),
			el( 'div', { className: 'summary-footer' }, this.done )
		);
		this.element = el( 'div', { className: 'summary-layer', role: 'dialog', ariaLabel: 'Mission summary' }, this.card );
		this.element.tabIndex = - 1;
		this.element.addEventListener( 'pointerdown', event => {
			if ( event.target === this.element ) { event.preventDefault(); this.done.focus(); }
		} );
		this.element.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); onClose(); }
			if ( event.key === 'Tab' && document.activeElement === this.element ) { event.preventDefault(); ( event.shiftKey ? this.done : this.header.close ).focus(); }
			else if ( event.key === 'Tab' && event.shiftKey && document.activeElement === this.header.close ) { event.preventDefault(); this.done.focus(); }
			else if ( event.key === 'Tab' && ! event.shiftKey && document.activeElement === this.done ) { event.preventDefault(); this.header.close.focus(); }

		} );
		this.element.hidden = true;
		this.element.setAttribute( 'aria-modal', 'true' );

	}

	/** @param summary { title, text, outcome: 'done' | 'failed', steps: [{ text, done }] } */
	show( { title, text, outcome = 'done', steps = [] } ) {

		this.header.setTitle( title );
		this.outcome.replaceChildren( el( 'span', { className: `badge is-${outcome}`, textContent: outcome } ) );
		this.text.textContent = text ?? '';
		this.steps.replaceChildren( ...steps.map( ( step ) => el( 'li', {
			className: `quest-step${step.done ? ' is-done' : ''}`
		}, el( 'span', { className: 'quest-step-mark' } ), el( 'span', { textContent: step.text } ) ) ) );
		this.element.hidden = false;
		this.element.setAttribute( 'aria-label', title || 'Mission summary' );
		this.onOpen();
		this.done.focus();

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;
		if ( visible ) this.done.focus();

	}

}
