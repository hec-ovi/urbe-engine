import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';

/**
 * The card that closes a mission: title, outcome, what happened, each step
 * ticked or not. props: { onClose() }
 */
export class MissionSummary {

	constructor( { onClose } ) {

		this.header = new PanelHeader( { title: '', onClose } );
		this.outcome = el( 'div', { className: 'detail-kind' } );
		this.text = el( 'p', { className: 'detail-text' } );
		this.steps = el( 'ul', { className: 'quest-steps' } );
		this.done = el( 'button', { className: 'hud-button is-primary', type: 'button', textContent: 'continue' } );
		this.done.addEventListener( 'click', onClose );

		this.element = el( 'div', { className: 'summary' },
			this.header.element,
			el( 'div', { className: 'summary-body' }, this.outcome, this.text, this.steps ),
			el( 'div', { className: 'summary-footer' }, this.done )
		);
		this.element.hidden = true;

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

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
