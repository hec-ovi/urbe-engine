import { el } from '../components/dom.js';
import { dockIcon } from '../components/DockIcon.js';
import { keyCap } from '../components/KeyCap.js';
import menu from '../views/game-menu.json' with { type: 'json' };

/**
 * The labelled dock under an open panel: Play, then every panel in the groups
 * of [game-menu.json](../views/game-menu.json)'s `dock`, each an icon over its
 * name with the key that opens it in the corner, and Leave, the way back to
 * the main menu. The open panel's entry is the current page. Arrow keys, Home
 * and End move along it. The keys are labels: the game binds them and calls
 * open( name ).
 * props: { onSelect( name ), onPlay(), onLeave() }
 */
export class GameDock {

	constructor( { onSelect, onPlay, onLeave = () => {} } ) {

		this.items = new Map();
		this.toolbar = el( 'div', { className: 'dock-items', role: 'toolbar' } );
		this.toolbar.setAttribute( 'aria-label', menu.dock.label );

		menu.dock.groups.forEach( ( group, index ) => group.forEach( ( name, at ) => {

			const item = this.#item( name, name === 'play' ? onPlay : name === 'LEAVE' ? onLeave : () => onSelect( name ) );
			if ( index > 0 && at === 0 ) item.classList.add( 'is-group-start' );
			this.toolbar.append( item );

		} ) );

		this.element = el( 'nav', { className: 'game-dock' },
			el( 'span', { className: 'dock-brand', ariaHidden: 'true' }, dockIcon( 'fracture', 28 ) ),
			this.toolbar
		);
		this.element.setAttribute( 'aria-label', menu.dock.label );
		this.toolbar.addEventListener( 'keydown', ( event ) => this.#move( event ) );
		this.setActive( null );

	}

	/** Marks the open panel's entry as the current page; null leaves Play current. */
	setActive( name ) {

		const current = this.items.has( name ) ? name : 'play';
		for ( const [ id, item ] of this.items ) {

			const active = id === current;
			item.setAttribute( 'aria-current', active ? 'page' : 'false' );
			item.tabIndex = active ? 0 : - 1;

		}

	}

	#item( name, onClick ) {

		const { label, key } = menu.entries[ name ];
		const item = el( 'button', { className: 'dock-item', type: 'button' },
			dockIcon( name ),
			el( 'span', { className: 'dock-label', textContent: label } ),
			...( key ? [ keyCap( key ) ] : [] )
		);
		item.dataset.dockItem = name;
		item.setAttribute( 'aria-label', label );
		if ( key ) item.setAttribute( 'aria-keyshortcuts', key === '?' ? 'Shift+Slash' : key );
		item.addEventListener( 'click', onClick );
		this.items.set( name, item );
		return item;

	}

	#move( event ) {

		const items = [ ...this.items.values() ].filter( ( item ) => ! item.hidden );
		const index = items.indexOf( event.target );
		if ( index < 0 ) return;
		const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 }[ event.key ];
		if ( next === undefined ) return;
		event.preventDefault();
		const target = items[ ( next + items.length ) % items.length ];
		for ( const item of items ) item.tabIndex = item === target ? 0 : - 1;
		target.focus();

	}

}
