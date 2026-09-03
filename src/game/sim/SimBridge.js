import { createSimulation, restoreSimulation } from '../../../../simulation/dist/index.js';

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
	static create( atlas, connections, buildings, params = {}, npcTypes = null, save = null ) {

		const interiors = {};

		for ( const [ parcelId, entry ] of buildings ) {

			if ( entry.npc ) interiors[ parcelId ] = entry.npc;

		}

		const input = {
			seed: atlas.meta.seed,
			blueprint: atlas,
			networks: connections.networks,
			interiors,
			params,
			...( npcTypes ? { npcTypes } : {} )
		};
		return new SimBridge( save ? restoreSimulation( input, save ) : createSimulation( input ) );

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

	continuityAt( npcId, timeMin ) {

		return this.simulation.continuityAt( npcId, timeMin );

	}

	interrupt( npcId, timeMin ) {

		this.simulation.interrupt( npcId, timeMin );

	}

	resume( npcId, timeMin ) {

		this.simulation.resume( npcId, timeMin );

	}

	serialize() {

		return this.simulation.serialize();

	}


	/** The story-side slice of the port (../../../../quests/CONTRACT.md SimulationPort): who exists, who is on duty, what the story did to them. */
	getNPC( npcId ) { return this.simulation.getNPC( npcId ); }
	findNPCs( query ) { return this.simulation.findNPCs( query ); }
	getNPCVendor( query ) { return this.simulation.getNPCVendor( query ); }
	reserveNPC( spec ) { return this.simulation.reserveNPC( spec ); }
	applyFlag( npcId, op ) { this.simulation.applyFlag( npcId, op ); }

}
