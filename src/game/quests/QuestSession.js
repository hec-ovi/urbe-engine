import { CastResolver, QuestlineRuntime, StepStamp, StoryVenues } from '../../../../quests/dist/runtime.js';
import { castIds } from './QuestCast.js';
import { stepLine, stepView } from './QuestStepView.js';

/**
 * The questlines of a world, running against the game's own simulation
 * (../../../../quests/CONTRACT.md): every role is cast here at load, so the
 * people the story needs are the people walking this city. Player events go to
 * every questline; what each one completes comes back for the HUD.
 */
export class QuestSession {

	/**
	 * @param entries [{ definition, side, runtime }]
	 * @param blocked questlines the cast could not fill, kept for the log with
	 * their reason: a job that vanishes from the menu reads as a broken game.
	 */
	constructor( entries, sim, blocked = [] ) {

		this.entries = entries;
		this.sim = sim;
		this.blocked = blocked;

	}

	/**
	 * @param definitions QuestlineDefinition list, main questline first
	 * @param sim the SimulationPort the runtime reads (SimBridge)
	 * @param timeMin when the cast is resolved: whoever is on duty around now
	 * @param persisted optional game-descriptor quest progress or compact snapshot() entries
	 * @param world the city the stories stand in (the Atlas blueprint, named or
	 * not): every authored place is stamped with its venue's name and a step
	 * whose text names an hour with the window the runtime gates on, so a
	 * questline written before places were named still plays
	 * @param types the Naming NPC types; with the world, casting looks past a
	 * pinned venue to every building that publishes the character's post
	 */
	static create( definitions, sim, timeMin, persisted = [], { world = null, types = null } = {} ) {

		const entries = [];
		const blocked = [];
		const stamp = world ? new StepStamp( world ) : null;
		const resolver = world && types ? new CastResolver( sim, new StoryVenues( world, types ) ) : new CastResolver( sim );
		// One person plays one character across the whole set, restored casts included.
		const taken = new Set();
		const characters = new Map();
		const saved = new Map( persisted.map( ( entry ) => [ entry.id, entry ] ) );

		for ( const [ index, carried ] of definitions.entries() ) {

			// The main questline is written first; everything after it is a side job.
			const side = index > 0;
			const definition = stamp ? stamp.definition( carried ) : carried;
			const previous = saved.get( definition.id );

			if ( previous ) {

				try {

					const snapshot = this.#persistedRuntime( definition, previous, sim );
					if ( snapshot ) {

						entries.push( {
							definition, side,
							runtime: QuestlineRuntime.restore( definition, snapshot.cast, sim, snapshot.state )
						} );
						for ( const npcId of Object.values( snapshot.cast ) ) taken.add( npcId );
						continue;

					}

				} catch ( error ) {

					console.warn( `questline ${definition.id} restore ignored: ${this.#message( error )}` );

				}

			}

			try {

				// The cast comes back with the questline as it is played: every
				// step moved onto the parcel its own character works at, so the
				// place the player is sent to is where that person really is.
				const result = resolver.cast( definition, timeMin, { taken, characters } );
				if ( result.blocked ) {

					this.#block( blocked, definition, castBlockReason( result.blocked ) );
					continue;

				}
				const played = result.definition ?? definition;
				entries.push( { definition: played, side, runtime: new QuestlineRuntime( played, result.cast, sim ) } );
				for ( const npcId of Object.values( result.cast ) ) taken.add( npcId );

			} catch ( error ) {

				this.#block( blocked, definition, this.#message( error ) );

			}

		}

		return new QuestSession( entries, sim, blocked );

	}

	/** Accepts game-descriptor progress or a compact snapshot() entry. */
	static #persistedRuntime( definition, persisted, sim ) {

		const snapshot = persisted.runtime ?? ( persisted.cast && persisted.state ? persisted : null );
		if ( ! snapshot ) return null;
		if ( persisted.totalSteps !== undefined && persisted.totalSteps !== definition.steps.length ) {

			throw new Error( `step count changed from ${persisted.totalSteps} to ${definition.steps.length}` );

		}

		const roleIds = new Set( definition.roles.map( ( role ) => role.roleId ) );
		const castRoleIds = Object.keys( snapshot.cast ?? {} );
		if ( castRoleIds.length !== roleIds.size || castRoleIds.some( ( id ) => ! roleIds.has( id ) ) ) {

			throw new Error( 'cast roles no longer match the definition' );

		}
		for ( const roleId of roleIds ) {

			const npcId = snapshot.cast[ roleId ];
			if ( typeof npcId !== 'string' ) throw new Error( `cast is missing role ${roleId}` );
			sim.getNPC( npcId );

		}

		const state = snapshot.state;
		if ( ! state || ! Array.isArray( state.activeStepIds ) || ! Array.isArray( state.completedStepIds ) || ! Array.isArray( state.flags ) ) {

			throw new Error( 'runtime state is incomplete' );

		}
		const stepIds = new Set( definition.steps.map( ( step ) => step.stepId ) );
		const flagIds = new Set( definition.flags );
		const endingIds = new Set( definition.endings.map( ( ending ) => ending.endingId ) );
		if ( [ ...state.activeStepIds, ...state.completedStepIds ].some( ( id ) => ! stepIds.has( id ) ) ) {

			throw new Error( 'runtime state names a step no longer in the definition' );

		}
		if ( state.activeStepIds.some( ( id ) => state.completedStepIds.includes( id ) ) ) {

			throw new Error( 'runtime state marks a step active and completed' );

		}
		if ( state.flags.some( ( flag ) => ! flagIds.has( flag ) ) ) {

			throw new Error( 'runtime state names a flag no longer in the definition' );

		}
		if ( state.endingId !== undefined && ! endingIds.has( state.endingId ) ) {

			throw new Error( 'runtime state names an ending no longer in the definition' );

		}
		if ( state.endingId === undefined && state.activeStepIds.length === 0 ) {

			throw new Error( 'runtime state has no active step or ending' );

		}
		if ( state.endingId !== undefined && state.activeStepIds.length > 0 ) {

			throw new Error( 'completed runtime state still has active steps' );

		}
		if ( Array.isArray( persisted.completedSteps ) && (
			persisted.completedSteps.length !== state.completedStepIds.length ||
			persisted.completedSteps.some( ( id ) => ! state.completedStepIds.includes( id ) )
		) ) {

			throw new Error( 'progress and runtime completed steps disagree' );

		}

		return snapshot;

	}

	/** A questline nobody can play stays in the log with what stopped it. */
	static #block( blocked, definition, reason ) {

		console.warn( `questline ${definition.id} not cast: ${reason}` );
		blocked.push( { id: definition.id, title: definition.title, text: definition.premise, reason } );

	}

	static #message( error ) {

		return error instanceof Error ? error.message : String( error );

	}

	get empty() {

		return this.entries.length === 0;

	}

	hasCastNpc( npcId ) {

		return this.entries.some( ( { runtime } ) => Object.values( runtime.cast ).includes( npcId ) );

	}

	/** Whether an open step still wants this person where the player found them. */
	holdsCast( npcId ) {

		return this.entries.some( ( { runtime } ) => runtime.activeSteps()
			.some( ( step ) => castIds( step.target, runtime ).includes( npcId ) ) );

	}

	/**
	 * @param event PlayerEvent
	 * @returns what changed: [{ definition, completed: [QuestStep], ending: QuestEnding | null }], only for questlines the event moved
	 */
	advance( event, timeMin ) {

		const moved = [];

		for ( const entry of this.entries ) {

			const change = this.#advanceEntry( entry, event, timeMin );
			if ( change ) moved.push( change );

		}

		return moved;

	}

	/** Applies an interaction to one selected questline, never another quest with the same item id. */
	advanceFor( questId, event, timeMin ) {

		const entry = this.entries.find( ( candidate ) => candidate.definition.id === questId );
		if ( ! entry ) return [];

		const change = this.#advanceEntry( entry, event, timeMin );
		return change ? [ change ] : [];

	}

	#advanceEntry( { definition, runtime }, event, timeMin ) {

		let result;

		try {

			result = runtime.advance( event, timeMin );

		} catch ( error ) {

			// Every questline sees every event, so a step that does not take this
			// one is the ordinary case and stays quiet. A step that would have
			// taken it and is gated off right now is worth saying out loud.
			if ( error?.code === 'E_UNAVAILABLE' ) {

				const open = runtime.activeSteps().map( ( step ) => step.stepId ).join( ', ' );
				console.warn( `questline ${definition.id} refused ${event.kind} at step ${open}: ${QuestSession.#message( error )}` );

			}
			return null;

		}

		const steps = new Map( definition.steps.map( ( step ) => [ step.stepId, step ] ) );
		return {
			definition,
			completed: result.completedStepIds.map( ( id ) => steps.get( id ) ),
			ending: definition.endings.find( ( ending ) => ending.endingId === result.endingId ) ?? null
		};

	}

	/** Every questline as it stands, for whoever else needs to know its part: [{ id, cast, state }]. */
	snapshot() {

		return this.entries.map( ( { definition, runtime } ) => ( { id: definition.id, cast: runtime.cast, state: runtime.serialize() } ) );

	}

	/** Game-descriptor progress records, including the complete restorable runtime. */
	persistenceView( timeMin = 0 ) {

		return this.entries.map( ( entry ) => {

			const { definition, runtime } = entry;
			const state = runtime.serialize();
			const status = runtime.status();
			const objective = status === 'completed'
				? runtime.ending()?.epilogue ?? definition.premise
				: runtime.activeSteps().map( ( step ) => stepLine( stepView( { step, runtime, sim: this.sim, timeMin } ) ) ).join( ' / ' ) || definition.premise;

			return {
				id: definition.id,
				title: definition.title,
				objective,
				state: this.#state( entry, status, state, 'completed' ),
				totalSteps: definition.steps.length,
				completedSteps: [ ...state.completedStepIds ],
				runtime: { cast: { ...runtime.cast }, state }
			};

		} );

	}

	/** Held quest items merged into the game descriptor's player inventory shape. */
	inventoryView() {

		const items = new Map();

		for ( const { definition, runtime } of this.entries ) {

			for ( const itemId of runtime.inventory() ) {

				const item = definition.items.find( ( candidate ) => candidate.itemId === itemId );
				if ( ! item ) continue;
				const present = items.get( itemId );
				if ( present ) {

					present.quantity += 1;
					present.state.questlineIds.push( definition.id );

				} else {

					items.set( itemId, {
						id: item.itemId,
						name: item.name,
						quantity: 1,
						state: { kind: item.kind, description: item.description, questlineIds: [ definition.id ] }
					} );

				}

			}

		}

		return [ ...items.values() ];

	}

	/**
	 * The quest log: every questline with its done and open steps. Each step is
	 * the one projection the HUD objective reads too, so the two never disagree.
	 */
	view( timeMin = 0 ) {

		return this.entries.map( ( entry ) => {

			const { definition, runtime } = entry;
			const state = runtime.serialize();
			const status = runtime.status();
			const steps = new Map( definition.steps.map( ( step ) => [ step.stepId, step ] ) );

			return {
				id: definition.id,
				title: definition.title,
				text: status === 'completed' ? runtime.ending()?.epilogue ?? definition.premise : definition.premise,
				state: this.#state( entry, status, state, 'done' ),
				steps: [
					...state.completedStepIds.map( ( id ) => stepView( { step: steps.get( id ), runtime, done: true } ) ),
					...runtime.activeSteps().map( ( step ) => stepView( { step, runtime, sim: this.sim, timeMin } ) )
				]
			};

		} ).concat( this.blocked.map( ( entry ) => ( {
			id: entry.id, title: entry.title, text: entry.text, state: 'blocked', note: entry.reason, steps: []
		} ) ) );

	}

	/** A side job nobody has started yet is on offer, not under way. */
	#state( { side }, status, state, completedWord ) {

		if ( status === 'completed' ) return completedWord;
		if ( status === 'stalled' ) return 'failed';
		return side && state.completedStepIds.length === 0 ? 'available' : 'active';

	}

}

/** The quests box's cast block, in one line for the log. */
function castBlockReason( block ) {

	return `role ${block.roleId} (${block.npcType}) cannot be cast: ${block.reason}`;

}
