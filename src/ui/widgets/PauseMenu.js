import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';
import { menuButton } from '../components/MenuButton.js';
import menu from '../views/game-menu.json' with { type: 'json' };

/**
 * The pause screen, up while the world holds: the sections of
 * [game-menu.json](../views/game-menu.json), each entry a button with a line
 * saying what it does and the key that opens it, then the keys to play with.
 * props: { onResume(), onOpen( name ), onSave(), onLeave() }
 */
export class PauseMenu {

	constructor( { onResume, onOpen = () => {}, onSave = () => {}, onLeave = () => {} } ) {

		const actions = { resume: onResume, save: onSave, LEAVE: onLeave };
		this.buttons = new Map();
		const title = el( 'h2', { className: 'hud-pause-title', id: 'pause-title', textContent: menu.pause.title } );

		this.element = el( 'div', { className: 'hud-pause' },
			el( 'div', { className: 'hud-pause-card' },
				title,
				el( 'p', { className: 'hud-pause-note', textContent: menu.pause.note } ),
				el( 'div', { className: 'hud-pause-sections' }, ...menu.pause.sections.map( ( section ) => el( 'section', { className: 'hud-pause-section' },
					el( 'h3', { className: 'hud-pause-heading', textContent: section.title } ),
					...section.entries.map( ( id ) => this.#entry( id, actions[ id ] ?? ( () => onOpen( id ) ) ) )
				) ) ),
				el( 'p', { className: 'hud-pause-keys' }, ...menu.pause.keys.map( ( { keys, action } ) => el( 'span', {},
					...keys.map( keyCap ), ` ${action}`
				) ) )
			)
		);
		this.element.setAttribute( 'role', 'dialog' );
		this.element.setAttribute( 'aria-labelledby', title.id );
		this.element.addEventListener( 'click', ( event ) => {

			if ( event.target === this.element ) onResume();

		} );

	}

	/** Shown, it puts focus on Resume, so Enter plays on, and forgets how the last save went. */
	setVisible( visible ) {

		const opening = visible && this.element.hidden;
		this.element.hidden = ! visible;
		if ( ! opening ) return;
		if ( this.saved === 'saved' || this.saved === 'failed' ) this.setSave( 'ready' );
		this.buttons.get( 'resume' )?.focus();

	}

	/** The Save entry as the game has it: `ready`, `saving`, `saved`, `failed`, or `unavailable` for a game that is not saved. */
	setSave( state ) {

		const text = menu.pause.save[ state ];
		if ( ! text ) throw new TypeError( `unknown save state: ${state}` );
		this.saved = state;
		const button = this.buttons.get( 'save' );
		if ( ! button ) return;
		button.disabled = state === 'unavailable' || state === 'saving';
		button.querySelector( '.menu-action-detail' ).textContent = text;

	}

	#entry( id, onClick ) {

		const { label, detail, key } = menu.entries[ id ];
		const button = menuButton( { label, detail, key, primary: id === 'resume', onClick } );
		this.buttons.set( id, button );
		return button;

	}

}
