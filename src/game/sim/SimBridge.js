import { createSimulation } from '../../../../simulation/dist/index.js';

/**
 * The simulation library (../simulation/CONTRACT.md) hosted by the game. The
 * engine owns no population model of its own: crowd density on a street, an
 * NPC's whole life on first interaction, and what it is doing right now all
 * come from here, over the same blueprint, networks and interior NPC support
 * the world was assembled from.
 */
export class SimBridge {

	/**
	 * @param atlas CityBlueprint
	 * @param connections ConnectionsOutput
	 * @param buildings Map<parcelId, { npc }>
	 * @param params statistical overrides per ../simulation/CONTRACT.md
	 * @param npcTypes the naming box's typed set for this world, or null for the built-in one
	 */
	static create( atlas, connections, buildings, params = {}, npcTypes = null ) {

		const interiors = {};

		for ( const [ parcelId, entry ] of buildings ) {

			if ( entry.npc ) interiors[ parcelId ] = entry.npc;

		}

		return new SimBridge( createSimulation( {
			seed: atlas.meta.seed,
			blueprint: atlas,
			networks: connections.networks,
			interiors,
			params,
			...( npcTypes ? { npcTypes } : {} )
		} ) );

	}

	constructor( simulation ) {

		this.simulation = simulation;

	}

	crowd( timeMin, scope, opts ) {

		return this.simulation.crowd( timeMin, scope, opts );

	}

	stats() {

		return this.simulation.populationStats();

	}

	/** Turns a crowd handle into a persistent NPC. Returns null if it went stale. */
	instantiate( crowdId, timeMin ) {

		try {

			return this.simulation.instantiate( { crowdId, timeMin } );

		} catch {

			return null;

		}

	}

	behaviorAt( npcId, timeMin ) {

		try {

			return this.simulation.behaviorAt( npcId, timeMin );

		} catch {

			return null;

		}

	}

	interrupt( npcId, timeMin ) {

		try {

			this.simulation.interrupt( npcId, timeMin );

		} catch {

			// A dead or unknown NPC simply cannot be interrupted.

		}

	}

	resume( npcId, timeMin ) {

		try {

			this.simulation.resume( npcId, timeMin );

		} catch {

			// Same: resuming what was never interrupted is not an error here.

		}

	}

}
