/** Batch width follows the machine unless the caller asks for an exact count. */
import { availableParallelism } from 'node:os';

export const WORKERS_ENV = 'URBE_ASSEMBLY_WORKERS';

export function defaultWorkers( env = process.env ) {

	const requested = Number( env[ WORKERS_ENV ] );
	if ( Number.isInteger( requested ) && requested > 0 ) return requested;
	return Math.max( 1, availableParallelism() - 1 );

}
