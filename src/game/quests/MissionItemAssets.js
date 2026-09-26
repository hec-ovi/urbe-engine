import { MissionAssetRegistry } from '../../mission-assets/src/index.js';

/**
 * Creates exact mission assemblies once and binds them to authored quest
 * items and fixed mechanics; staged scenes read the same assemblies by id.
 */
export class MissionItemAssets {

	constructor( { requests, bindings, mechanicBindings = [], materialCatalog } ) {

		const registry = new MissionAssetRegistry( materialCatalog );
		this.assets = new Map( requests.map( ( request ) => [ request.assetId, registry.create( request ) ] ) );
		const bound = ( assetId ) => registry.get( { contractVersion: '1.0', assetId } );
		this.items = new Map( bindings.map( ( binding ) => [ key( binding.questId, binding.itemId ), bound( binding.assetId ) ] ) );
		this.mechanics = new Map( mechanicBindings.map( ( binding ) => {

			const assembly = bound( binding.assetId );
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

	/** The assembly built for one requested asset, or null when the bundle requests none by that id. */
	asset( assetId ) {

		return this.assets.get( assetId ) ?? null;

	}

}

function key( questId, itemId ) {

	return `${questId}\u0000${itemId}`;

}
