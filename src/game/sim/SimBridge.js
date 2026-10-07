import { createSimulation, restoreSimulation } from '../../../../simulation/dist/index.js';
import { homesOf } from './Homes.js';

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
	 * @param avoidNames the story cast's names nobody else draws (Homes.castNames), or null
	 */
	static create( atlas, connections, buildings, params = {}, npcTypes = null, save = null, avoidNames = null ) {

		const interiors = {};

		for ( const [ parcelId, entry ] of buildings ) {

			if ( ! entry.npc ) continue;
			// A furnished building's dwellings, so the people who live in it live in a real apartment of it.
			const homes = homesOf( entry );
			interiors[ parcelId ] = homes.length ? { ...entry.npc, homes } : entry.npc;

		}

		const input = {
			seed: atlas.meta.seed,
			blueprint: atlas,
			networks: connections.networks,
			interiors,
			params,
			...( npcTypes ? { npcTypes } : {} ),
			...( avoidNames?.full?.length ? { avoidNames } : {} )
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

	/**
	 * Turns a crowd handle into a persistent NPC. Returns null if it went stale
	 * or was refused.
	 *
	 * @param appearanceSeed the seed the body on screen is drawn with; a person
	 * this call establishes takes it, so naming a body never changes its look
	 */
	instantiate( crowdId, timeMin, appearanceSeed = null ) {

		try {

			return this.simulation.instantiate( { crowdId, timeMin, ...( appearanceSeed == null ? {} : { appearanceSeed } ) } );

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


	/**
	 * Establishes a person the simulation names as somebody's family (a household
	 * member, a sibling living elsewhere) by their id, as a save replays it: the
	 * same person every time. Throws as the simulation does (`E_CAPACITY` once it
	 * holds all the people it may).
	 */
	relative( npcId ) {

		return this.simulation.instantiate( { npcId } );

	}

	/** The story-side slice of the port (../../../../quests/CONTRACT.md SimulationPort): who exists, who is on duty, what the story did to them. */
	getNPC( npcId ) { return this.simulation.getNPC( npcId ); }
	findNPCs( query ) { return this.simulation.findNPCs( query ); }
	getNPCVendor( query ) { return this.simulation.getNPCVendor( query ); }
	reserveNPC( spec ) { return this.simulation.reserveNPC( spec ); }
	applyFlag( npcId, op ) { this.simulation.applyFlag( npcId, op ); }

}
