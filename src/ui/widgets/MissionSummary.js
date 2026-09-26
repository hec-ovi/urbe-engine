import { el } from '../components/dom.js';
import { PanelHeader } from '../components/PanelHeader.js';
import { prose } from '../components/Prose.js';
import layout from './summary-layout.json' with { type: 'json' };

/**
 * The story card over the game: the prologue a new game opens on, or the
 * card that closes a mission with its outcome and each step ticked or not.
 * Labels come from summary-layout.json (summary-layout.schema.json).
 * props: { onClose({ pointer }), onOpen() }; `pointer` is true when a click
 * closed it and false for Escape, which leaves the pointer where it was.
 */
export class MissionSummary {

	constructor( { onClose, onOpen = () => {} } ) {

		this.onOpen = onOpen;
		const click = () => onClose( { pointer: true } );

		this.header = new PanelHeader( { title: '', onClose: click } );
		this.outcome = el( 'div', { className: 'detail-kind' } );
		this.text = el( 'div', { className: 'prose' } );
		this.steps = el( 'ul', { className: 'quest-steps' } );
		this.done = el( 'button', { className: 'hud-button is-primary', type: 'button', textContent: layout.kinds.outcome.action } );
		this.done.addEventListener( 'click', click );

		this.card = el( 'div', { className: 'summary' },
			this.header.element,
			el( 'div', { className: 'summary-body' }, this.outcome, this.text, this.steps ),
			el( 'div', { className: 'summary-footer' }, this.done )
		);
		this.element = el( 'div', { className: 'summary-layer', role: 'dialog', ariaLabel: layout.label }, this.card );
		this.element.tabIndex = - 1;
		this.element.addEventListener( 'pointerdown', event => {
			if ( event.target === this.element ) { event.preventDefault(); this.done.focus(); }
		} );
		this.element.addEventListener( 'keydown', ( event ) => {

			if ( event.key === 'Escape' ) { event.preventDefault(); event.stopPropagation(); onClose( { pointer: false } ); }
			if ( event.key === 'Tab' && document.activeElement === this.element ) { event.preventDefault(); ( event.shiftKey ? this.done : this.header.close ).focus(); }
			else if ( event.key === 'Tab' && event.shiftKey && document.activeElement === this.header.close ) { event.preventDefault(); this.done.focus(); }
			else if ( event.key === 'Tab' && ! event.shiftKey && document.activeElement === this.done ) { event.preventDefault(); this.header.close.focus(); }

		} );
		this.element.hidden = true;
		this.element.setAttribute( 'aria-modal', 'true' );

	}

	/**
	 * @param summary { kind: 'outcome' | 'prologue', title, text, outcome: 'done' | 'failed', steps: [{ text, done }] };
	 * a blank line in `text` starts a new paragraph; a kind the layout lacks shows as an outcome
	 */
	show( { kind = 'outcome', title, text, outcome = 'done', steps = [] } ) {

		const labels = layout.kinds[ kind ] ?? layout.kinds.outcome;
		this.header.setTitle( title );
		this.outcome.replaceChildren( labels.kicker ?? el( 'span', { className: `badge is-${outcome}`, textContent: outcome } ) );
		this.text.replaceChildren( ...prose( text ) );
		this.steps.replaceChildren( ...steps.map( ( step ) => el( 'li', {
			className: `quest-step${step.done ? ' is-done' : ''}`
		}, el( 'span', { className: 'quest-step-mark' } ), el( 'span', { textContent: step.text } ) ) ) );
		this.done.textContent = labels.action;
		this.element.hidden = false;
		this.element.setAttribute( 'aria-label', title || layout.label );
		this.onOpen();
		this.done.focus();

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;
		if ( visible ) this.done.focus();

	}

}
