/**
 * Sweeps the shared store: every set no world on disk points at any more.
 *   npm run gc [-- --dry-run]
 * `--dry-run` lists what a sweep would remove and deletes nothing.
 */

import { collect, sweepLine } from './SharedResources.js';

const args = process.argv.slice( 2 );

if ( args.some( ( arg ) => arg !== '--dry-run' ) ) {

	console.error( 'usage: npm run gc [-- --dry-run]' );
	process.exit( 2 );

}

const dryRun = args.includes( '--dry-run' );

try {

	const result = collect( undefined, [], { dryRun } );

	for ( const entry of result.removed.entries ) console.log( `${dryRun ? 'would remove' : 'removed'} ${entry}` );
	for ( const entry of result.failed.entries ) console.log( `could not remove ${entry}` );
	console.log( sweepLine( result, { dryRun } ) );

} catch ( error ) {

	console.error( `${error.code ?? 'ERROR'}: ${error.message}` );
	process.exit( 1 );

}
