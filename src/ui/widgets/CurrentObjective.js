import { el } from '../components/dom.js';

const EMPTY = '';

/** Quiet, persistent access to the active quest from the gameplay HUD. */
export class CurrentObjective {

	constructor( { onOpen = () => {} } = {} ) {

		this.state = el( 'span', { className: 'hud-objective-state' } );
		this.title = el( 'strong', { className: 'hud-objective-title' } );
		this.text = el( 'span', { className: 'hud-objective-text' } );
		this.place = el( 'span', { className: 'hud-objective-place' } );
		this.hours = el( 'span', { className: 'hud-objective-hours' } );
		this.element = el( 'button', { className: 'hud-objective', type: 'button', ariaLive: 'polite' },
			this.state,
			this.title,
			this.text,
			this.place,
			this.hours
		);
		this.element.addEventListener( 'click', onOpen );
		this.setObjective( null );

	}

	/**
	 * @param value null or { title, objective, state: 'active' | 'done', place }
	 * with place null or { name, distanceMeters?, window? }: where the objective
	 * sends the player, how far the route there runs, and, while the place is
	 * closed, the hour it opens as { label, startMin, endMin }
	 */
	setObjective( value ) {

		const title = value?.title?.trim?.() || EMPTY;
		const objective = value?.objective?.trim?.() || EMPTY;
		const place = placeLine( value?.place );
		const hours = hoursLine( value?.place?.window );
		if ( ! title && ! objective ) {

			this.element.hidden = true;
			this.element.classList.remove( 'is-done' );
			this.state.textContent = EMPTY;
			this.title.textContent = EMPTY;
			this.text.textContent = EMPTY;
			this.place.textContent = EMPTY;
			this.hours.textContent = EMPTY;
			this.element.removeAttribute( 'aria-label' );
			return;

		}

		const done = value?.state === 'done';
		this.element.hidden = false;
		this.element.classList.toggle( 'is-done', done );
		this.state.textContent = done ? 'Objective complete' : 'Current objective';
		this.title.textContent = title;
		this.title.hidden = ! title;
		this.text.textContent = objective;
		this.text.hidden = ! objective;
		this.place.textContent = place;
		this.place.hidden = ! place;
		this.hours.textContent = hours;
		this.hours.hidden = ! hours;
		this.element.setAttribute( 'aria-label', `${ done ? 'Objective complete' : 'Open current quest' }: ${ [ title, objective, place, hours ].filter( Boolean ).join( ', ' ) }` );

	}

}

/** "Diner, 120 m": the venue, and the walk to it while a route stands. */
function placeLine( place ) {

	const name = place?.name?.trim?.() || EMPTY;
	if ( ! name ) return EMPTY;
	return Number.isFinite( place.distanceMeters ) ? `${name}, ${place.distanceMeters} m` : name;

}

/** "Opens during the slow hour, 18:00 to 23:00": the step's own words for its hour, and the clock. */
function hoursLine( window ) {

	const label = window?.label?.trim?.() || EMPTY;
	if ( ! label || ! Number.isFinite( window.startMin ) || ! Number.isFinite( window.endMin ) ) return EMPTY;
	return `Opens ${label}, ${clock( window.startMin )} to ${clock( window.endMin )}`;

}

function clock( minuteOfDay ) {

	const hours = Math.floor( minuteOfDay / 60 ) % 24;
	const minutes = minuteOfDay % 60;
	return `${String( hours ).padStart( 2, '0' )}:${String( minutes ).padStart( 2, '0' )}`;

}
