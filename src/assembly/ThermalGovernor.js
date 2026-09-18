import { readFileSync, readdirSync } from 'node:fs';
import { maxTemperature } from './Parallelism.js';

const HWMON = '/sys/class/hwmon';
const SAMPLE_MS = 2000;
// Read below the target before widening again, so the pool does not oscillate.
const RELEASE = 4;

/**
 * Keeps a batch inside a temperature the owner is comfortable with.
 *
 * The pool asks `width()` before it dispatches. While the machine reads above
 * the target the governor narrows the batch one worker at a time, and widens it
 * again once the machine has cooled past the target by RELEASE degrees. A
 * machine that exposes no temperature, and a target of zero, leave the batch at
 * full width, so this never turns into a silent slowdown on another platform.
 */
export class ThermalGovernor {

	/**
	 * @param size the batch's full width
	 * @param target degrees Celsius to stay under, 0 or absent disables
	 * @param read optional reading function, for tests
	 */
	constructor( size, target = maxTemperature(), read = cpuTemperature ) {

		this.size = size;
		this.target = target;
		this.read = read;
		this.allowed = size;
		this.checked = - Infinity;
		this.narrowed = 0;

	}

	/** @returns how many workers may run right now. */
	width( now = Date.now() ) {

		if ( ! this.target || this.size < 2 ) return this.size;
		if ( now - this.checked < SAMPLE_MS ) return this.allowed;

		this.checked = now;
		const temperature = this.read();

		if ( temperature === null ) return this.allowed;
		if ( temperature > this.target && this.allowed > 1 ) {

			this.allowed --;
			this.narrowed ++;

		} else if ( temperature < this.target - RELEASE && this.allowed < this.size ) this.allowed ++;

		return this.allowed;

	}

	/** What the batch did about heat, for the run's report. */
	summary() {

		return this.target
			? `held under ${this.target} C, narrowed ${this.narrowed} times, ${this.allowed} of ${this.size} workers now`
			: null;

	}

}

/** The hottest package sensor this machine publishes, or null where there is none. */
export function cpuTemperature() {

	let hottest = null;

	try {

		for ( const chip of readdirSync( HWMON ) ) {

			const name = text( `${HWMON}/${chip}/name` );
			if ( name !== 'k10temp' && name !== 'coretemp' && name !== 'acpitz' ) continue;

			for ( const entry of readdirSync( `${HWMON}/${chip}` ) ) {

				if ( ! /^temp\d+_input$/.test( entry ) ) continue;
				const value = Number( text( `${HWMON}/${chip}/${entry}` ) ) / 1000;
				if ( Number.isFinite( value ) && ( hottest === null || value > hottest ) ) hottest = value;

			}

		}

	} catch { return null; }

	return hottest;

}

function text( path ) {

	try { return readFileSync( path, 'utf8' ).trim(); } catch { return ''; }

}
