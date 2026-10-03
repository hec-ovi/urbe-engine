import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import { keyCap } from '../components/KeyCap.js';

/**
 * The crosshair, and the one line telling the player what E would do; a
 * door with a lock carries a small mark before it, shut while it is locked
 * to the player and open once they carry its card.
 */
export class InteractPrompt {

	constructor() {

		this.prompt = el( 'div', { className: 'hud-prompt', role: 'status' } );
		this.prompt.hidden = true;
		this.element = el( 'div', { className: 'hud-interaction' },
			el( 'div', { className: 'hud-crosshair' } ),
			this.prompt
		);

	}

	/** @param lock optional `{ locked }` of the door aimed at, or null */
	update( text, { lock = null } = {} ) {

		this.prompt.hidden = ! text;

		const mark = text && lock ? ( lock.locked ? 'locked' : 'unlocked' ) : null;
		if ( text === this.text && mark === this.mark ) return;
		this.text = text;
		this.mark = mark;
		this.element.classList.toggle( 'is-locked', mark === 'locked' );
		this.element.classList.toggle( 'has-target', Boolean( text ) );
		// Prompts remain authored by the interaction owners, including E/R and lift keys.
		const parts = String( text ?? '' ).split( /\b(E|R|PgUp|PgDn|Page Up|Page Down)\b/g );
		const lockMark = mark ? el( 'span', { className: `hud-prompt-lock is-${mark}`, title: mark === 'locked' ? 'Locked' : 'Unlocked' }, icon( mark === 'locked' ? 'lock' : 'unlock' ) ) : null;
		this.prompt.replaceChildren( ...( lockMark ? [ lockMark ] : [] ), ...parts.map( ( part, i ) => i % 2 ? keyCap( part ) : document.createTextNode( part ) ) );

	}

}
