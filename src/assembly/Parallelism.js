/**
 * Batch width: a quarter of the machine unless the caller asks for an exact
 * count. A shell generator saturates a core; opening one per core pins a
 * 32-thread machine near 100 C. The thermal governor holds the batch under a
 * ceiling on top of that, because a quarter of the cores on its own still took
 * this machine to 98 C. It is on by default and the environment overrides it.
 *
 * The ceiling reads a sustained temperature, never an instant one: a sensor
 * spiking for one boosted core cannot tell one worker from eight, and acting
 * on that reading would collapse the batch to a serial build. So a sustained
 * reading narrows the batch one worker at a time, and the worker cap stays the
 * first heat control.
 *
 * The ceiling is DEFAULT_MAX_TEMP, the temperature this project asks its
 * batches to hold under, and it drops MARGIN degrees below the throttle point
 * on a machine whose driver publishes one lower than that. It is never raised
 * to meet the hardware: a desktop CPU boosts until it meets its own limit, so
 * the die under load sits wherever the boost algorithm parks it, which on this
 * machine is 95 to 98 C, and a ceiling read off that number would be no
 * ceiling at all. The consequence is the intended one: on a machine that runs
 * that hot the batch narrows towards its floor and stays there, which is the
 * ceiling working rather than failing.
 */
import { availableParallelism } from 'node:os';

export const WORKERS_ENV = 'URBE_ASSEMBLY_WORKERS';
export const MAX_TEMP_ENV = 'URBE_ASSEMBLY_MAX_TEMP';
/** What the project asks a batch to hold under, in degrees Celsius. */
export const DEFAULT_MAX_TEMP = 90;
/** How far under a published throttle point the batch stays. */
export const MARGIN = 3;
const CORE_SHARE = 4;

export function defaultWorkers( env = process.env ) {

	const requested = Number( env[ WORKERS_ENV ] );
	if ( Number.isInteger( requested ) && requested > 0 ) return requested;
	return Math.max( 1, Math.floor( availableParallelism() / CORE_SHARE ) );

}

/**
 * Degrees Celsius the batch stays under: the project's own, lowered to stay
 * MARGIN under a throttle point the driver publishes below it. The
 * environment sets its own and 0 disables it.
 *
 * @param throttle the die's own throttle point, or null where none is published
 */
export function maxTemperature( env = process.env, throttle = null ) {

	const ceiling = Number.isFinite( throttle ) && throttle > 0
		? Math.min( DEFAULT_MAX_TEMP, throttle - MARGIN )
		: DEFAULT_MAX_TEMP;

	if ( ! ( MAX_TEMP_ENV in env ) ) return ceiling;
	const requested = Number( env[ MAX_TEMP_ENV ] );
	return Number.isFinite( requested ) && requested >= 0 ? requested : ceiling;

}
