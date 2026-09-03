import { MissionAssetRegistry } from '../../mission-assets/src/index.js';

/** Creates exact mission assemblies once and binds them to authored quest items. */
export class MissionItemAssets {

	constructor( { requests, bindings, materialCatalog } ) {

		const registry = new MissionAssetRegistry( materialCatalog );
		for ( const request of requests ) registry.create( request );
		this.items = new Map( bindings.map( ( binding ) => [
			key( binding.questId, binding.itemId ),
			registry.get( { contractVersion: '1.0', assetId: binding.assetId } )
		] ) );

	}

	get( questId, itemId ) {

		return this.items.get( key( questId, itemId ) ) ?? null;

	}

}

function key( questId, itemId ) {

	return `${questId}\u0000${itemId}`;

}
