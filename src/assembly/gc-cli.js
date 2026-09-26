/**
 * Sweeps the shared store: every set no world on disk points at any more.
 *   npm run gc [-- --dry-run] [--grace <hours>] [--worlds <dir>]
 * `--grace` spares sets a batch used within that many hours, a day by default,
 * so a sweep beside a running batch never takes what it draws; `--grace 0`
 * sweeps every set no world names, for a machine where nothing is building.
 * `--worlds` adds a folder of worlds outside engine/out that read this store,
 * and may repeat. `--dry-run` lists what a sweep would remove and deletes nothing.
 * Exits 1 when a world cannot be read, having removed nothing, and 2 on a bad flag.
 */

import { parseArgs } from 'node:util';
import { collect, OUT_DIR, SWEEP_GRACE_MS, sweepLine } from './SharedResources.js';

const HOUR_MS = 60 * 60 * 1000;
const USAGE = 'usage: npm run gc [-- --dry-run] [--grace <hours>] [--worlds <dir>]';

let options;

try {

	( { values: options } = parseArgs( { options: {
		'dry-run': { type: 'boolean', default: false },
		grace: { type: 'string', default: String( SWEEP_GRACE_MS / HOUR_MS ) },
		worlds: { type: 'string', multiple: true, default: [] }
	} } ) );

} catch ( error ) {

	console.error( `${error.message}\n${USAGE}` );
	process.exit( 2 );

}

if ( ! /^\d+(\.\d+)?$/.test( options.grace ) ) {

	console.error( `--grace takes hours, 0 or more\n${USAGE}` );
	process.exit( 2 );

}

const dryRun = options[ 'dry-run' ];

try {

	const result = collect( OUT_DIR, options.worlds, { grace: Number( options.grace ) * HOUR_MS, dryRun } );

	for ( const entry of result.removed.entries ) console.log( `${dryRun ? 'would remove' : 'removed'} ${entry}` );
	for ( const entry of result.failed.entries ) console.log( `could not remove ${entry}` );
	console.log( sweepLine( result, { dryRun } ) );

} catch ( error ) {

	console.error( `${error.code ?? 'ERROR'}: ${error.message}` );
	process.exit( 1 );

}
