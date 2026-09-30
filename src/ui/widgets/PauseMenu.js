import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';
import { menuButton } from '../components/MenuButton.js';
import { fractureLogo } from '../components/FractureLogo.js';
import menu from '../views/game-menu.json' with { type: 'json' };

/**
 * The pause screen, up while the world holds: one sheet over the dimmed city
 * with the Fracture wordmark, a small eyebrow over the title and its note,
 * the sections of [game-menu.json](../views/game-menu.json) as rows of a name
 * and its key (what each does is its tooltip and description), how saving
 * goes, then the keys to play with. It rises in as it opens.
 * props: { onResume(), onOpen( name ), onSave(), onLeave() }
 */
export class PauseMenu {

	constructor( { onResume, onOpen = () => {}, onSave = () => {}, onLeave = () => {} } ) {

		const actions = { resume: onResume, save: onSave, LEAVE: onLeave };
		this.buttons = new Map();
		const title = el( 'h2', { className: 'hud-pause-title', id: 'pause-title', textContent: menu.pause.title } );
		this.status = el( 'p', { className: 'hud-pause-status', role: 'status' } );

		this.element = el( 'div', { className: 'hud-pause' },
			el( 'div', { className: 'hud-pause-card' },
				el( 'div', { className: 'hud-pause-brand' }, fractureLogo() ),
				el( 'p', { className: 'hud-pause-eyebrow', textContent: menu.pause.eyebrow } ),
				title,
				el( 'p', { className: 'hud-pause-note', textContent: menu.pause.note } ),
				el( 'div', { className: 'hud-pause-sections' }, ...menu.pause.sections.map( ( section ) => el( 'section', { className: 'hud-pause-section' },
					el( 'h3', { className: 'hud-pause-heading', textContent: section.title } ),
					...section.entries.map( ( id ) => this.#entry( id, actions[ id ] ?? ( () => onOpen( id ) ) ) )
				) ) ),
				this.status,
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
		this.setSave( 'ready' );

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
		this.status.textContent = text;
		this.status.dataset.state = state;
		const button = this.buttons.get( 'save' );
		if ( ! button ) return;
		button.disabled = state === 'unavailable' || state === 'saving';
		button.querySelector( '.menu-action-detail' ).textContent = text;
		button.title = text;

	}

	#entry( id, onClick ) {

		const { label, detail, key } = menu.entries[ id ];
		const button = menuButton( { label, detail, key, primary: id === 'resume', onClick } );
		const line = button.querySelector( '.menu-action-detail' );
		line.id = `pause-${id.toLowerCase()}-detail`;
		button.setAttribute( 'aria-describedby', line.id );
		button.dataset.entry = id;
		button.title = detail;
		this.buttons.set( id, button );
		return button;

	}

}
