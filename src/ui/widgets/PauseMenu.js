import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';

/**
 * Shown whenever the pointer is not locked, which is also what Escape does.
 * It says so, because a first person game that silently stops responding to
 * the mouse reads as broken.
 */
export class PauseMenu {

	constructor( { onResume } ) {

		const resume = el( 'button', { className: 'hud-button', type: 'button', textContent: 'Resume' } );
		resume.addEventListener( 'click', onResume );

		this.element = el( 'div', { className: 'hud-pause' },
			el( 'div', { className: 'hud-pause-title', textContent: 'Paused' } ),
			el( 'div', { className: 'hud-pause-note' },
				'Click to look around. ', keyCap( 'Esc' ), ' releases the mouse and pauses again.'
			),
			el( 'div', { className: 'hud-pause-note' },
				keyCap( 'W' ), keyCap( 'A' ), keyCap( 'S' ), keyCap( 'D' ), ' walk · ',
				keyCap( 'Shift' ), ' run · ',
				keyCap( 'E' ), ' doors and people'
			),
			el( 'div', { className: 'hud-pause-note' }, 'The bar below lists every panel and its key.' ),
			resume
		);

		this.element.addEventListener( 'click', ( event ) => {

			if ( event.target === this.element ) onResume();

		} );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
