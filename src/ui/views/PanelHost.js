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

		for ( const view of Object.values( views ) ) view.element.hidden = true;

		this.onKey = ( event ) => {

			if ( event.key === 'Escape' ) this.close();

		};

	}

	open( name ) {

		if ( ! this.views[ name ] || this.current === name ) return;

		if ( this.current ) this.#hide( this.views[ this.current ] );
		else window.addEventListener( 'keydown', this.onKey );

		this.current = name;
		this.element.classList.add( 'is-open' );
		this.#show( this.views[ name ] );
		this.onOpen( name );

	}

	close() {

		if ( ! this.current ) return;

		this.#hide( this.views[ this.current ] );
		this.current = null;
		this.element.classList.remove( 'is-open' );
		window.removeEventListener( 'keydown', this.onKey );
		this.onClose();

	}

	toggle( name ) {

		this.current === name ? this.close() : this.open( name );

	}

	#show( view ) {

		clearTimeout( this.timers.get( view ) );
		view.element.hidden = false;
		void view.element.offsetWidth;
		view.element.classList.add( 'is-open' );
		view.shown?.();

	}

	#hide( view ) {

		view.element.classList.remove( 'is-open' );
		this.timers.set( view, setTimeout( () => { view.element.hidden = true; }, CLOSE_MS ) );

	}

}
