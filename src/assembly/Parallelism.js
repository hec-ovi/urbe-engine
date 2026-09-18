/**
 * Batch width: a quarter of the machine unless the caller asks for an exact
 * count. A shell generator saturates a core; opening one per core pins a
 * 32-thread machine near 100 C. The thermal governor narrows the batch further
 * when the owner sets a ceiling. Off by default: a package sensor that reads
 * 95 C for one boosted core cannot tell one worker from eight and would only
 * slow the batch to one; the worker cap is the heat control.
 */
import { availableParallelism } from 'node:os';

export const WORKERS_ENV = 'URBE_ASSEMBLY_WORKERS';
export const MAX_TEMP_ENV = 'URBE_ASSEMBLY_MAX_TEMP';
export const DEFAULT_MAX_TEMP = 0;
const CORE_SHARE = 4;

export function defaultWorkers( env = process.env ) {

	const requested = Number( env[ WORKERS_ENV ] );
	if ( Number.isInteger( requested ) && requested > 0 ) return requested;
	return Math.max( 1, Math.floor( availableParallelism() / CORE_SHARE ) );

}

/** Degrees Celsius the batch stays under when the environment sets one; 0 disables. */
export function maxTemperature( env = process.env ) {

	if ( ! ( MAX_TEMP_ENV in env ) ) return DEFAULT_MAX_TEMP;
	const requested = Number( env[ MAX_TEMP_ENV ] );
	return Number.isFinite( requested ) && requested >= 0 ? requested : DEFAULT_MAX_TEMP;

}
