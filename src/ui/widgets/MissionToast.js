import { el } from '../components/dom.js';
import { icon } from '../components/Icon.js';
import layout from './toast-layout.json' with { type: 'json' };

/** Timings match the .toast transitions in mission.css. */
const IN_MS = 240;
const HOLD_MS = 3600;
const OUT_MS = 600;

/** The icon a gain's tile shows until, or instead of, its picture. */
const ICONS = { item: 'inventory', contact: 'phone', companion: 'follow' };

/**
 * A line under the clock that slides in, holds, and fades out on its own.
 * A gain (`kind` item, contact or companion) carries a square tile with its
 * picture, an item's card or a person's face, that arrives with a short
 * sweep; labels come from [toast-layout.json](toast-layout.json).
 */
export class MissionToast {

	constructor() {

		this.element = el( 'div', { className: 'toast-host' } );
		this.timers = new Map();

	}

	/**
	 * @param toast { title, text?, kind?, image? }: `kind` is update (the
	 * default), item, contact or companion, `text` falls back to the kind's own
	 * line, and `image` is the gain's picture, a URL or a promise of one (or
	 * null), shown in the tile once it arrives while the notice is up.
	 * @returns the notice element
	 */
	show( { title, text, kind = 'update', image = null } ) {

		while ( this.element.childElementCount >= 2 ) this.dismiss( this.element.firstElementChild );
		const labels = layout.kinds[ kind ] ?? layout.kinds.update;
		const words = text ?? labels.text ?? '';
		const dismiss = el( 'button', { className: 'toast-close', type: 'button', ariaLabel: layout.dismiss, textContent: '×' } );
		const copy = [
			el( 'span', { className: 'toast-kicker', textContent: labels.kicker } ), dismiss,
			el( 'div', { className: 'toast-title', textContent: title } ),
			...( words ? [ el( 'div', { className: 'toast-text', textContent: words } ) ] : [] )
		];
		const tile = ICONS[ kind ] ? this.#tile( kind, title, image ) : null;
		const toast = tile
			? el( 'div', { className: `toast is-gain is-${kind}`, role: 'status' }, tile, el( 'div', { className: 'toast-copy' }, ...copy ) )
			: el( 'div', { className: 'toast', role: 'status' }, ...copy );

		this.element.append( toast );
		toast.classList.add( 'is-in' );
		dismiss.addEventListener( 'click', () => this.dismiss( toast ) );

		this.timers.set( toast, [
			setTimeout( () => toast.classList.add( 'is-out' ), IN_MS + HOLD_MS ),
			setTimeout( () => this.dismiss( toast ), IN_MS + HOLD_MS + OUT_MS )
		] );
		return toast;

	}

	/** A gain's tile: its kind's icon, swapped for the picture once it arrives. */
	#tile( kind, title, image ) {

		const tile = el( 'span', { className: 'toast-tile', ariaHidden: 'true' }, icon( ICONS[ kind ] ) );
		Promise.resolve( image ).then( ( url ) => {

			if ( typeof url !== 'string' || ! url || ! tile.isConnected ) return;
			tile.replaceChildren( el( 'img', { className: 'toast-picture', src: url, alt: '', draggable: false } ) );
			tile.classList.add( 'has-picture' );

		}, () => {} );
		tile.title = title;
		return tile;

	}

	dismiss( toast ) {

		for ( const timer of this.timers.get( toast ) ?? [] ) clearTimeout( timer );
		this.timers.delete( toast );
		toast.remove();

	}

	destroy() {

		for ( const toast of this.timers.keys() ) this.dismiss( toast );
		this.element.remove();

	}

}
