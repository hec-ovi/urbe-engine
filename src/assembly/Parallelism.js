/**
 * Batch width: a quarter of the machine unless the caller asks for an exact
 * count. A shell generator saturates a core; opening one per core pins a
 * 32-thread machine near 100 C. The thermal governor narrows the batch further
 * while the package runs hot. The ceiling sits above a single core's boost
 * reading (about 85 C on a Strix Halo Tctl sensor) so one worker always runs.
 */
import { availableParallelism } from 'node:os';

export const WORKERS_ENV = 'URBE_ASSEMBLY_WORKERS';
export const MAX_TEMP_ENV = 'URBE_ASSEMBLY_MAX_TEMP';
export const DEFAULT_MAX_TEMP = 90;
const CORE_SHARE = 4;

export function defaultWorkers( env = process.env ) {

	const requested = Number( env[ WORKERS_ENV ] );
	if ( Number.isInteger( requested ) && requested > 0 ) return requested;
	return Math.max( 1, Math.floor( availableParallelism() / CORE_SHARE ) );

}

/** Degrees Celsius the batch stays under; 0 disables throttling. */
export function maxTemperature( env = process.env ) {

	if ( ! ( MAX_TEMP_ENV in env ) ) return DEFAULT_MAX_TEMP;
	const requested = Number( env[ MAX_TEMP_ENV ] );
	return Number.isFinite( requested ) && requested >= 0 ? requested : DEFAULT_MAX_TEMP;

}
