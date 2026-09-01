import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';

/** Every entry in bar order: the panel name it opens and the key that opens it. */
export const TABS = [
	[ 'QUESTS', 'J' ],
	[ 'MAP', 'M' ],
	[ 'INVENTORY', 'I' ],
	[ 'CODEX', 'X' ],
	[ 'SETTINGS', 'O' ],
	[ 'CONTROLS', '?' ]
];

/**
 * The bottom bar: six panel tabs and LEAVE on the far right. The keys are
 * labels; the game binds them and calls open( name ).
 * props: { onSelect( name ), onLeave() }
 */
export class TabBar {

	constructor( { onSelect, onLeave } ) {

		this.tabs = new Map();

		this.element = el( 'nav', { className: 'tabbar' },
			...TABS.map( ( [ name, key ] ) => this.#tab( name, key, () => onSelect( name ) ) ),
			this.#tab( 'LEAVE', 'N', onLeave, 'is-leave' )
		);

	}

	/** Lights the tab of the open panel; null clears it. */
	setActive( name ) {

		for ( const [ tabName, tab ] of this.tabs ) tab.classList.toggle( 'is-active', tabName === name );

	}

	#tab( name, key, onClick, extra = '' ) {

		const tab = el( 'button', { className: `tab ${extra}`.trim(), type: 'button' },
			icon( name.toLowerCase() ),
			el( 'span', { className: 'tab-label', textContent: name } ),
			el( 'span', { className: 'tab-key', textContent: key } )
		);
		tab.addEventListener( 'click', onClick );
		this.tabs.set( name, tab );

		return tab;

	}

}
