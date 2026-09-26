import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import menu from '../views/game-menu.json' with { type: 'json' };

/**
 * The bottom bar: one tab per panel in [menu](../views/game-menu.json) order
 * with the key that opens it, and Leave on the far right. The keys are
 * labels; the game binds them and calls open( name ).
 * props: { onSelect( name ), onLeave() }
 */
export class TabBar {

	constructor( { onSelect, onLeave } ) {

		this.tabs = new Map();

		this.element = el( 'nav', { className: 'tabbar', ariaLabel: 'Game panels' },
			...menu.tabs.map( ( name ) => this.#tab( name, () => onSelect( name ) ) ),
			this.#tab( 'LEAVE', onLeave, 'is-leave' )
		);

	}

	/** Lights the tab of the open panel; null clears it. */
	setActive( name ) {

		for ( const [ tabName, tab ] of this.tabs ) {

			const active = tabName === name;
			tab.classList.toggle( 'is-active', active );
			if ( tabName !== 'LEAVE' ) tab.setAttribute( 'aria-pressed', String( active ) );

		}

	}

	#tab( name, onClick, extra = '' ) {

		const { label, key } = menu.entries[ name ];
		const tab = el( 'button', { className: `tab ${extra}`.trim(), type: 'button' },
			icon( name.toLowerCase() ),
			el( 'span', { className: 'tab-label', textContent: label } ),
			...( key ? [ el( 'span', { className: 'tab-key', textContent: key } ) ] : [] )
		);
		if ( name !== 'LEAVE' ) tab.setAttribute( 'aria-pressed', 'false' );
		tab.addEventListener( 'click', onClick );
		this.tabs.set( name, tab );

		return tab;

	}

}
