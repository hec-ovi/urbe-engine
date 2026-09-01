const MINUTES_PER_DAY = 1440;
const DAYS = [ 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun' ];

/**
 * World time in the simulation's own unit: integer minutes since Monday 00:00
 * (../simulation/CONTRACT.md). One real second is one world second, so a game
 * day is a real day; the scale exists only for debugging and defaults to 1.
 */
export class GameClock {

	constructor( { startHour = 21, scale = 1 } = {} ) {

		this.seconds = startHour * 3600;
		this.scale = scale;

	}

	advance( delta ) {

		this.seconds += delta * this.scale;

	}

	/** Integer minutes since the world epoch, the simulation's `timeMin`. */
	get timeMin() {

		return Math.floor( this.seconds / 60 );

	}

	/** Seconds since midnight, for the signal controllers' closed-form cycle. */
	get daySeconds() {

		return this.seconds % 86400;

	}

	get hour() {

		return ( this.seconds / 3600 ) % 24;

	}

	get label() {

		const minuteOfDay = this.timeMin % MINUTES_PER_DAY;
		const day = DAYS[ Math.floor( this.timeMin / MINUTES_PER_DAY ) % 7 ];
		const hh = String( Math.floor( minuteOfDay / 60 ) ).padStart( 2, '0' );
		const mm = String( minuteOfDay % 60 ).padStart( 2, '0' );

		return `${day} ${hh}:${mm}`;

	}

}
