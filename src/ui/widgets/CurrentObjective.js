import { el } from '../components/dom.js';

const EMPTY = '';

/** Quiet, persistent access to the active quest from the gameplay HUD. */
export class CurrentObjective {

	constructor( { onOpen = () => {} } = {} ) {

		this.state = el( 'span', { className: 'hud-objective-state' } );
		this.title = el( 'strong', { className: 'hud-objective-title' } );
		this.text = el( 'span', { className: 'hud-objective-text' } );
		this.element = el( 'button', { className: 'hud-objective', type: 'button', ariaLive: 'polite' },
			this.state,
			this.title,
			this.text
		);
		this.element.addEventListener( 'click', onOpen );
		this.setObjective( null );

	}

	/** @param value null or { title, objective, state: 'active' | 'done' } */
	setObjective( value ) {

		const title = value?.title?.trim?.() || EMPTY;
		const objective = value?.objective?.trim?.() || EMPTY;
		if ( ! title && ! objective ) {

			this.element.hidden = true;
			this.element.classList.remove( 'is-done' );
			this.state.textContent = EMPTY;
			this.title.textContent = EMPTY;
			this.text.textContent = EMPTY;
			this.element.removeAttribute( 'aria-label' );
			return;

		}

		const done = value?.state === 'done';
		this.element.hidden = false;
		this.element.classList.toggle( 'is-done', done );
		this.state.textContent = done ? 'Objective complete' : 'Current objective';
		this.title.textContent = title;
		this.title.hidden = ! title;
		this.text.textContent = objective;
		this.text.hidden = ! objective;
		this.element.setAttribute( 'aria-label', `${ done ? 'Objective complete' : 'Open current quest' }: ${ [ title, objective ].filter( Boolean ).join( ', ' ) }` );

	}

}
