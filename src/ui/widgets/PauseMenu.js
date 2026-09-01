import { el } from '../components/dom.js';

/**
 * Shown whenever the pointer is not locked, which is also what Escape does.
 * It says so, because a first person game that silently stops responding to
 * the mouse reads as broken.
 */
export class PauseMenu {

	constructor( { onResume } ) {

		const key = ( text ) => el( 'span', { className: 'hud-pause-key', textContent: text } );

		this.element = el( 'div', { className: 'hud-pause' },
			el( 'div', { className: 'hud-pause-title', textContent: 'Paused' } ),
			el( 'div', { className: 'hud-pause-note' },
				'Click to look around. ', key( 'Esc' ), ' releases the mouse and pauses again.'
			),
			el( 'div', { className: 'hud-pause-note' },
				key( 'W' ), key( 'A' ), key( 'S' ), key( 'D' ), ' walk · ',
				key( 'Shift' ), ' run · ',
				key( 'E' ), ' doors and people'
			),
			el( 'div', { className: 'hud-pause-note' },
				key( 'M' ), ' map · ', key( 'I' ), ' inventory'
			),
			el( 'button', {
				className: 'hud-npc-close',
				type: 'button',
				textContent: 'Resume',
				style: 'max-width:220px'
			} )
		);

		this.element.querySelector( 'button' ).addEventListener( 'click', onResume );
		this.element.addEventListener( 'click', ( event ) => {

			if ( event.target === this.element ) onResume();

		} );

	}

	setVisible( visible ) {

		this.element.hidden = ! visible;

	}

}
