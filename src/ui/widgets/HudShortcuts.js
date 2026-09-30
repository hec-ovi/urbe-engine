import { el } from '../components/dom.js';
import { keyCap } from '../components/KeyCap.js';

/** Quiet references to the real game bindings. The icon dock owns navigation. */
export class HudShortcuts {
	constructor() {
		this.element = el( 'div', { className: 'hud-shortcuts', ariaLabel: 'Gameplay shortcuts' },
			... [ [ 'E', 'Interact' ], [ 'J', 'Journal' ], [ 'M', 'Map' ], [ '?', 'Controls' ] ].map( ( [ key, label ] ) =>
				el( 'span', {}, keyCap( key ), label ) ) );
	}
}
