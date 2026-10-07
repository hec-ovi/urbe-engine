import { WAGE } from './Prices.js';

/** The first payday, Friday 17:00, in minutes since Monday 00:00, and a week of minutes. */
export const PAYDAY_MIN = 6780;
export const WEEK_MIN = 10080;
/** Most weeks of pay one payday books: a long wait catches up two weeks, no more. */
const MAX_WEEKS = 2;
/** The wallet's log keeps this many of the latest entries. */
const LOG_SIZE = 40;
const MAX_CREDITS = 999999;

/** How many paydays have come by game minute `t`: none before the first Friday 17:00. */
export function paydaysBy( t ) {

	return Math.max( 0, Math.floor( ( t - PAYDAY_MIN ) / WEEK_MIN ) + 1 );

}

/**
 * The player's credits, the paydays already paid (`paidWeek`, a count of
 * paydays) and a log of the latest changes, each
 * `{ atMin, what, amount, npcId?, name? }` with `amount` signed: spent is
 * negative, received positive.
 */
export class Wallet {

	constructor( { credits = WAGE.start, paidWeek = 0, log = [] } = {} ) {

		this.credits = clamp( credits );
		this.paidWeek = Math.max( 0, Math.floor( paidWeek ) );
		this.log = log.slice( - LOG_SIZE ).map( ( entry ) => ( { ...entry } ) );

	}

	/** Whether the player can pay `n` whole credits. */
	can( n ) {

		return Number.isInteger( n ) && n >= 0 && n <= this.credits;

	}

	/** Pays `n` out; false, and nothing changes, when the player cannot. */
	spend( n, entry = {} ) {

		if ( ! this.can( n ) ) return false;
		this.credits -= n;
		this.#record( entry, - n );
		return true;

	}

	/** Takes `n` in. */
	add( n, entry = {} ) {

		if ( ! Number.isInteger( n ) || n < 0 ) throw new Error( `credits must be a whole number, not ${n}` );
		this.credits = clamp( this.credits + n );
		this.#record( entry, n );

	}

	/** A line in the log that moves nothing, as an offer refused. */
	note( entry ) {

		this.#record( entry, 0 );

	}

	/**
	 * Books the pay of every payday come by `t` and not paid yet, at most
	 * MAX_WEEKS of them, less the file fee each: `{ weeks, gross, fee, net }`,
	 * or null when nothing is due.
	 */
	payday( t ) {

		const due = paydaysBy( t );
		if ( due <= this.paidWeek ) return null;
		const weeks = Math.min( MAX_WEEKS, due - this.paidWeek );
		this.paidWeek = due;
		const gross = weeks * WAGE.week;
		const fee = weeks * WAGE.fee;
		const net = gross - fee;
		this.add( net, { atMin: t, what: 'wage' } );
		return { weeks, gross, fee, net };

	}

	serialize() {

		return { credits: this.credits, paidWeek: this.paidWeek, log: this.log.map( ( entry ) => ( { ...entry } ) ) };

	}

	/** The saved wallet; with none (a save made before credits), the starting credits and no pay owed for weeks already gone by `t`. */
	static restore( saved, t = 0 ) {

		if ( saved ) return new Wallet( saved );
		return new Wallet( { credits: WAGE.start, paidWeek: paydaysBy( t ) } );

	}

	#record( { atMin = 0, what = 'paid', npcId = null, name = null } = {}, amount ) {

		this.log.push( {
			atMin: Math.max( 0, Number.isFinite( atMin ) ? atMin : 0 ), what, amount,
			...( npcId ? { npcId } : {} ), ...( name ? { name: String( name ).slice( 0, 120 ) } : {} )
		} );
		if ( this.log.length > LOG_SIZE ) this.log.splice( 0, this.log.length - LOG_SIZE );

	}

}

function clamp( credits ) {

	return Math.min( MAX_CREDITS, Math.max( 0, Math.floor( Number( credits ) || 0 ) ) );

}
