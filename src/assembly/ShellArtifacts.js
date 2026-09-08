import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ShellCatalog } from './ShellCatalog.js';
import { RooftopSpanPlan } from './RooftopSpanPlan.js';
import { AssemblyError } from './RequestAssembler.js';

/** Keeps only compact projections while reading one completed shell at a time. */
export async function collectShellArtifacts( directory, parcelIds, { seed } ) {

	const catalog = new ShellCatalog( seed );
	const rooftops = new RooftopSpanPlan( { meta: { seed } } );
	for ( const id of parcelIds ) {

		try {

			const blueprint = JSON.parse( await readFile( join( directory, id, `${id}.blueprint.json` ), 'utf8' ) );
			catalog.add( id, blueprint );
			rooftops.add( id, blueprint );

		} catch ( error ) {

			if ( error.code === 'E_SHELL_CATALOG' ) throw error;
			throw new AssemblyError( 'E_SHELL_CATALOG', `${id}: ${error.message}` );

		}

	}
	return { catalog: catalog.value(), rooftopRequest: rooftops.request() };

}
