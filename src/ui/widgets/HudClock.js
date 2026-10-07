import { el } from '../components/dom.js';

/** How long a change in credits stays marked. */
const CHANGE_MS = 1200;

/** World time and where the player is standing, centred at the top. */
export class HudClock {

	constructor() {

		this.time = el( 'time', { className: 'hud-clock-time' } );
		this.day = el( 'span', { className: 'hud-clock-day' } );
		this.phase = el( 'span', { className: 'hud-clock-phase' } );
		this.credits = el( 'span', { className: 'hud-clock-credits', hidden: true } );
		this.shownCredits = null;
		this.place = el( 'strong', { className: 'hud-clock-place' } );
		this.location = el( 'span', { className: 'hud-clock-location' } );
		this.element = el( 'section', { className: 'hud-clock', ariaLabel: 'Time and location' },
			el( 'div', { className: 'hud-clock-top' }, this.time, el( 'div', { className: 'hud-clock-calendar' }, this.day, this.phase, this.credits ) ),
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

	/**
	 * The credits the player has on them (`40 cr`), or null to show none. A
	 * change marks itself `data-change` up or down for a moment, so a payment
	 * or a pay day catches the eye.
	 */
	setCredits( credits ) {

		if ( credits === null || credits === undefined ) {

			this.credits.hidden = true;
			this.shownCredits = null;
			return;

		}
		const text = `${credits} cr`;
		if ( this.shownCredits !== null && credits !== this.shownCredits ) {

			this.credits.dataset.change = credits > this.shownCredits ? 'up' : 'down';
			clearTimeout( this.changeTimer );
			this.changeTimer = setTimeout( () => delete this.credits.dataset.change, CHANGE_MS );

		}
		if ( this.credits.textContent !== text ) this.credits.textContent = text;
		this.credits.setAttribute( 'aria-label', `Credits: ${credits}` );
		this.credits.hidden = false;
		this.shownCredits = credits;

	}

	/** dawn, day, dusk or night, so the clock says what the sky is doing. */
	setState( state ) {

		if ( this.element.dataset.state === state ) return;

		this.element.dataset.state = state;
		this.phase.textContent = state;

	}

}
