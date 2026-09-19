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
 * Where the ceiling sits is measured, not chosen. A desktop CPU boosts until
 * it meets its own limit, so the die under any sustained load sits just under
 * its throttle point rather than at a comfortable number: the die on this
 * machine holds 95 to 97 C through an ordinary compile and reached 98 C
 * through a city assembly. So the ceiling stays MARGIN degrees under the
 * throttle point the driver publishes, and where it publishes none, as k10temp
 * does not, it is DEFAULT_MAX_TEMP: above that the batch is pushing the die
 * past what any other work on this machine reaches.
 */
import { availableParallelism } from 'node:os';

export const WORKERS_ENV = 'URBE_ASSEMBLY_WORKERS';
export const MAX_TEMP_ENV = 'URBE_ASSEMBLY_MAX_TEMP';
export const DEFAULT_MAX_TEMP = 97;
/** How far under a published throttle point the batch stays. */
export const MARGIN = 3;
const CORE_SHARE = 4;

export function defaultWorkers( env = process.env ) {

	const requested = Number( env[ WORKERS_ENV ] );
	if ( Number.isInteger( requested ) && requested > 0 ) return requested;
	return Math.max( 1, Math.floor( availableParallelism() / CORE_SHARE ) );

}

/**
 * Degrees Celsius the batch stays under. The environment sets its own and 0
 * disables it; otherwise it follows the die's throttle point where the driver
 * publishes one.
 *
 * @param throttle the die's own throttle point, or null where none is published
 */
export function maxTemperature( env = process.env, throttle = null ) {

	const ceiling = Number.isFinite( throttle ) && throttle > 0 ? throttle - MARGIN : DEFAULT_MAX_TEMP;

	if ( ! ( MAX_TEMP_ENV in env ) ) return ceiling;
	const requested = Number( env[ MAX_TEMP_ENV ] );
	return Number.isFinite( requested ) && requested >= 0 ? requested : ceiling;

}
