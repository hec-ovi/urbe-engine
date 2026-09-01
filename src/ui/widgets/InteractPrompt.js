import { el } from '../components/dom.js';

/** The crosshair, and the one line telling the player what E would do. */
export class InteractPrompt {

	constructor() {

		this.prompt = el( 'div', { className: 'hud-prompt' } );
		this.prompt.hidden = true;
		this.element = el( 'div', {},
			el( 'div', { className: 'hud-crosshair' } ),
			this.prompt
		);

	}

	update( text ) {

		this.prompt.hidden = ! text;

		if ( text && this.prompt.textContent !== text ) this.prompt.textContent = text;

	}

}
