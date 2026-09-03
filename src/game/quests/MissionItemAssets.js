import { MissionAssetRegistry } from '../../mission-assets/src/index.js';

/** Creates exact mission assemblies once and binds them to authored quest items and fixed mechanics. */
export class MissionItemAssets {

	constructor( { requests, bindings, mechanicBindings = [], materialCatalog } ) {

		const registry = new MissionAssetRegistry( materialCatalog );
		for ( const request of requests ) registry.create( request );
		this.items = new Map( bindings.map( ( binding ) => [
			key( binding.questId, binding.itemId ),
			registry.get( { contractVersion: '1.0', assetId: binding.assetId } )
		] ) );
		this.mechanics = new Map( mechanicBindings.map( ( binding ) => {

			const assembly = registry.get( { contractVersion: '1.0', assetId: binding.assetId } );
			const anchor = assembly.interactionAnchors.find( ( candidate ) => candidate.interaction === binding.interactionId );
			if ( ! anchor ) throw new Error( `mission asset ${binding.assetId} has no ${binding.interactionId} anchor` );
			return [ key( binding.questId, binding.stepId ), { binding: { ...binding }, assembly, anchor } ];

		} ) );

	}

	mechanic( questId, stepId ) {

		return this.mechanics.get( key( questId, stepId ) ) ?? null;

	}

	get( questId, itemId ) {

		return this.items.get( key( questId, itemId ) ) ?? null;

	}

}

function key( questId, itemId ) {

	return `${questId}\u0000${itemId}`;

}
