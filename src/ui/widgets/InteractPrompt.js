import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';

/** The crosshair, and the one line telling the player what E would do. */
export class InteractPrompt {

	constructor() {

		this.prompt = el( 'div', { className: 'hud-prompt', role: 'status' } );
		this.prompt.hidden = true;
		this.element = el( 'div', { className: 'hud-interaction' },
			el( 'div', { className: 'hud-crosshair' } ),
			this.prompt
		);

	}

	update( text ) {

		this.prompt.hidden = ! text;

		if ( text === this.text ) return;
		this.text = text;
		this.element.classList.toggle( 'has-target', Boolean( text ) );
		// Prompts remain authored by the interaction owners, including E/R and lift keys.
		const parts = String( text ?? '' ).split( /\b(E|R|PgUp|PgDn|Page Up|Page Down)\b/g );
		this.prompt.replaceChildren( ...parts.map( ( part, i ) => i % 2 ? keyCap( part ) : document.createTextNode( part ) ) );

	}

}
