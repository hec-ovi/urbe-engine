import { el } from '../components/dom.js';

/** Timings match the .toast transitions in mission.css. */
const IN_MS = 240;
const HOLD_MS = 3600;
const OUT_MS = 600;

/** A line under the clock that slides in, holds, and fades out on its own. */
export class MissionToast {

	constructor() {

		this.element = el( 'div', { className: 'toast-host' } );

	}

	/** @param toast { title, text } */
	show( { title, text } ) {

		const toast = el( 'div', { className: 'toast' },
			el( 'div', { className: 'toast-title', textContent: title } ),
			el( 'div', { className: 'toast-text', textContent: text } )
		);

		this.element.append( toast );
		void toast.offsetWidth;
		toast.classList.add( 'is-in' );

		setTimeout( () => toast.classList.add( 'is-out' ), IN_MS + HOLD_MS );
		setTimeout( () => toast.remove(), IN_MS + HOLD_MS + OUT_MS );

	}

}
