import { el } from '../components/dom.js';

/** Matches the .view transition in panels.css. */
const CLOSE_MS = 160;

/**
 * Shows one full panel at a time over the game. Opening one closes the
 * others; Escape closes whatever is open. Views are { element, shown?() }.
 * props: { views: { NAME: view }, onOpen( name ), onClose() }
 */
export class PanelHost {

	constructor( { views, onOpen, onClose } ) {

		this.views = views;
		this.onOpen = onOpen;
		this.onClose = onClose;
		this.current = null;
		this.timers = new Map();
		this.element = el( 'div', { className: 'panel-host' }, ...Object.values( views ).map( ( view ) => view.element ) );

		for ( const view of Object.values( views ) ) {

			view.element.hidden = true;
			view.element.inert = true;

		}

		this.onKey = ( event ) => {

			if ( event.key === 'Escape' ) this.close();

		};

	}

	open( name ) {

		if ( ! this.views[ name ] || this.current === name ) return;
		const active = document.activeElement;
		if ( active && active !== document.body && ! this.element.contains( active ) ) this.returnFocus = active;

		if ( this.current ) this.#hide( this.views[ this.current ] );
		else window.addEventListener( 'keydown', this.onKey );

		this.current = name;
		this.element.classList.add( 'is-open' );
		this.#show( this.views[ name ], name );
		this.onOpen( name );

	}

	close() {

		if ( ! this.current ) return;

		this.#hide( this.views[ this.current ] );
		this.current = null;
		this.element.classList.remove( 'is-open' );
		window.removeEventListener( 'keydown', this.onKey );
		this.onClose();
		if ( this.returnFocus?.isConnected && ! this.returnFocus.closest( '[hidden]' ) ) this.returnFocus.focus();
		this.returnFocus = null;

	}

	toggle( name ) {

		this.current === name ? this.close() : this.open( name );

	}

	#show( view, name ) {

		clearTimeout( this.timers.get( view ) );
		view.element.hidden = false;
		view.element.inert = false;
		view.element.setAttribute( 'role', 'dialog' );
		view.element.setAttribute( 'aria-label', name[ 0 ] + name.slice( 1 ).toLowerCase() );
		view.element.removeAttribute( 'aria-hidden' );
		void view.element.offsetWidth;
		view.element.classList.add( 'is-open' );
		view.shown?.();
		const firstControl = view.element.querySelector( 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])' );
		if ( firstControl ) firstControl.focus();
		else {

			view.element.tabIndex = - 1;
			view.element.focus();

		}

	}

	#hide( view ) {

		view.element.classList.remove( 'is-open' );
		view.element.inert = true;
		view.element.setAttribute( 'aria-hidden', 'true' );
		this.timers.set( view, setTimeout( () => { view.element.hidden = true; }, CLOSE_MS ) );

	}

}
