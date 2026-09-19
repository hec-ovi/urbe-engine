import { readFileSync, readdirSync } from 'node:fs';
import { maxTemperature } from './Parallelism.js';

const HWMON = '/sys/class/hwmon';
const SAMPLE_MS = 2000;
// Read below the target before widening again, so the pool does not oscillate.
const RELEASE = 4;
/** Readings the decision is taken on, and how it is taken: the middle one. */
const WINDOW = 3;
/**
 * The narrowest the batch goes. Below this the build is serial and a city
 * takes hours, and a machine still over the ceiling at two workers is telling
 * the owner the worker cap is wrong, not the governor.
 */
const MIN_WIDTH = 2;
/** The sensors that read the die, and the chassis probe that stands in for them. */
const DIE = new Set( [ 'k10temp', 'coretemp' ] );
const CHASSIS = 'acpitz';

/**
 * Keeps a batch inside a temperature the owner is comfortable with.
 *
 * The pool asks `width()` before it dispatches. The governor samples the
 * machine every two seconds and decides on the middle of the last three
 * readings, so a package sensor spiking for one boosted core cannot narrow the
 * batch: only a temperature the machine actually holds can. While that
 * sustained reading stands above the target the batch narrows one worker at a
 * time, down to MIN_WIDTH, and widens again once the machine has cooled past
 * the target by RELEASE degrees. A machine that exposes no temperature, and a
 * target of zero, leave the batch at full width, so this never turns into a
 * silent slowdown on another platform.
 */
export class ThermalGovernor {

	/**
	 * @param size the batch's full width
	 * @param target degrees Celsius to stay under, 0 or absent disables
	 * @param read optional reading function, for tests
	 */
	constructor( size, target = maxTemperature( process.env, throttlePoint() ), read = cpuTemperature ) {

		this.size = size;
		this.target = target;
		this.read = read;
		this.allowed = size;
		this.checked = - Infinity;
		this.narrowed = 0;
		this.floor = Math.min( size, MIN_WIDTH );
		this.window = [];

	}

	/** @returns how many workers may run right now. */
	width( now = Date.now() ) {

		if ( ! this.target || this.size < 2 ) return this.size;
		if ( now - this.checked < SAMPLE_MS ) return this.allowed;

		this.checked = now;
		const temperature = this.read();

		if ( temperature === null ) return this.allowed;

		this.window.push( temperature );
		if ( this.window.length > WINDOW ) this.window.shift();
		// A decision needs a held reading, so the first samples of a run change nothing.
		if ( this.window.length < WINDOW ) return this.allowed;

		const sustained = [ ...this.window ].sort( ( a, b ) => a - b )[ ( WINDOW - 1 ) >> 1 ];

		if ( sustained > this.target && this.allowed > this.floor ) {

			this.allowed --;
			this.narrowed ++;

		} else if ( sustained < this.target - RELEASE && this.allowed < this.size ) this.allowed ++;

		return this.allowed;

	}

	/** What the batch did about heat, for the run's report. */
	summary() {

		return this.target
			? `held under ${this.target} C, narrowed ${this.narrowed} times, ${this.allowed} of ${this.size} workers now`
			: null;

	}

}

/**
 * How hot the cores are, or null on a machine that does not say.
 *
 * The die sensors are the ones that answer that question: `k10temp` on AMD,
 * `coretemp` on Intel. `acpitz` is a chassis probe and on this machine it
 * reads eleven degrees above the die while the die sits at 80 C, so a ceiling
 * measured against it would narrow the batch over case airflow rather than
 * over work. It is read only where neither die sensor exists.
 */
export function cpuTemperature( chips = sensors() ) {

	const die = chips.filter( ( chip ) => DIE.has( chip.name ) );
	const read = die.length ? die : chips.filter( ( chip ) => chip.name === CHASSIS );
	let hottest = null;

	for ( const chip of read ) {

		for ( const value of chip.values ?? [] ) if ( hottest === null || value > hottest ) hottest = value;

	}

	return hottest;

}

/**
 * The die's own throttle point, where its driver publishes one: `tempN_crit`
 * on the drivers that expose it, `tempN_max` otherwise. k10temp on this
 * machine publishes neither, only Tctl, so this is null here and the ceiling
 * falls back to the measured default.
 */
export function throttlePoint( chips = sensors() ) {

	const die = chips.filter( ( chip ) => DIE.has( chip.name ) );
	let lowest = null;

	for ( const chip of die ) {

		for ( const value of chip.limits ) if ( lowest === null || value < lowest ) lowest = value;

	}

	return lowest;

}

/** Every temperature this machine publishes, by the chip that publishes it. */
function sensors() {

	const chips = [];

	try {

		for ( const chip of readdirSync( HWMON ) ) {

			const name = text( `${HWMON}/${chip}/name` );
			if ( ! DIE.has( name ) && name !== CHASSIS ) continue;

			const values = [];
			const limits = [];

			for ( const entry of readdirSync( `${HWMON}/${chip}` ) ) {

				const value = Number( text( `${HWMON}/${chip}/${entry}` ) ) / 1000;
				if ( ! Number.isFinite( value ) ) continue;
				if ( /^temp\d+_input$/.test( entry ) ) values.push( value );
				else if ( /^temp\d+_(crit|max)$/.test( entry ) ) limits.push( value );

			}
			if ( values.length ) chips.push( { name, values, limits } );

		}

	} catch { return []; }

	return chips;

}

function text( path ) {

	try { return readFileSync( path, 'utf8' ).trim(); } catch { return ''; }

}
