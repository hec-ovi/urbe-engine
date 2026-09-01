import { el } from '../components/dom.js';

/** World time and where the player is standing, centred at the top. */
export class HudClock {

	constructor() {

		this.time = el( 'div', {} );
		this.place = el( 'div', { className: 'hud-clock-place' } );
		this.element = el( 'div', { className: 'hud-clock' }, this.time, this.place );

	}

	update( time, place ) {

		if ( this.time.textContent !== time ) this.time.textContent = time;
		if ( this.place.textContent !== place ) this.place.textContent = place;

	}

	/** dawn, day, dusk or night, so the clock says what the sky is doing. */
	setState( state ) {

		if ( this.element.dataset.state === state ) return;

		this.element.dataset.state = state;

	}

}
