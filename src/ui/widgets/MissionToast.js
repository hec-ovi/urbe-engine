import { el } from '../components/dom.js';

/** Timings match the .toast transitions in mission.css. */
const IN_MS = 240;
const HOLD_MS = 3600;
const OUT_MS = 600;

/** A line under the clock that slides in, holds, and fades out on its own. */
export class MissionToast {

	constructor() {

		this.element = el( 'div', { className: 'toast-host' } );
		this.timers = new Map();

	}

	/** @param toast { title, text } */
	show( { title, text } ) {

		while ( this.element.childElementCount >= 2 ) this.dismiss( this.element.firstElementChild );
		const dismiss = el( 'button', { className: 'toast-close', type: 'button', ariaLabel: 'Dismiss notice', textContent: '×' } );
		const toast = el( 'div', { className: 'toast', role: 'status' },
			el( 'span', { className: 'toast-kicker', textContent: 'UPDATE' } ), dismiss,
			el( 'div', { className: 'toast-title', textContent: title } ),
			el( 'div', { className: 'toast-text', textContent: text } )
		);

		this.element.append( toast );
		toast.classList.add( 'is-in' );
		dismiss.addEventListener( 'click', () => this.dismiss( toast ) );

		this.timers.set( toast, [
			setTimeout( () => toast.classList.add( 'is-out' ), IN_MS + HOLD_MS ),
			setTimeout( () => this.dismiss( toast ), IN_MS + HOLD_MS + OUT_MS )
		] );

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
