import { el } from '../components/dom.js';

/** World time and where the player is standing, centred at the top. */
export class HudClock {

	constructor() {

		this.time = el( 'time', { className: 'hud-clock-time' } );
		this.day = el( 'span', { className: 'hud-clock-day' } );
		this.phase = el( 'span', { className: 'hud-clock-phase' } );
		this.place = el( 'strong', { className: 'hud-clock-place' } );
		this.location = el( 'span', { className: 'hud-clock-location' } );
		this.element = el( 'section', { className: 'hud-clock', ariaLabel: 'Time and location' },
			el( 'div', { className: 'hud-clock-top' }, this.time, el( 'div', { className: 'hud-clock-calendar' }, this.day, this.phase ) ),
			el( 'div', { className: 'hud-clock-where' }, el( 'span', { textContent: '+', ariaHidden: 'true' } ),
				el( 'div', {}, this.place, this.location ) ) );

	}

	update( time, place, location = '' ) {

		const parts = /^(\S+) (\d{2}:\d{2})$/.exec( time );
		for ( const [ node, value ] of [ [ this.time, parts?.[ 2 ] ?? time ], [ this.day, parts?.[ 1 ] ?? '' ], [ this.place, place ], [ this.location, location === place ? '' : location ] ] ) {
			if ( node.textContent !== value ) node.textContent = value;
		}
		this.location.hidden = ! this.location.textContent;

	}

	/** dawn, day, dusk or night, so the clock says what the sky is doing. */
	setState( state ) {

		if ( this.element.dataset.state === state ) return;

		this.element.dataset.state = state;
		this.phase.textContent = state;

	}

}
