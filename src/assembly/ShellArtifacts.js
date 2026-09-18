import { BuildingBlueprints } from './BuildingBlueprints.js';
import { ShellCatalog } from './ShellCatalog.js';
import { RooftopSpanPlan } from './RooftopSpanPlan.js';
import { AssemblyError } from './RequestAssembler.js';

/** Keeps only compact projections while reading one standing building at a time. */
export async function collectShellArtifacts( directory, parcelIds, { seed, plans } ) {

	const catalog = new ShellCatalog( seed );
	const rooftops = new RooftopSpanPlan( { meta: { seed } } );
	const blueprints = new BuildingBlueprints( directory, plans );
	for ( const id of parcelIds ) {

		try {

			const blueprint = await blueprints.of( id );
			catalog.add( id, blueprint );
			rooftops.add( id, blueprint );

		} catch ( error ) {

			if ( error.code === 'E_SHELL_CATALOG' ) throw error;
			throw new AssemblyError( 'E_SHELL_CATALOG', `${id}: ${error.message}` );

		}

	}
	return { catalog: catalog.value(), rooftopRequest: rooftops.request() };

}
