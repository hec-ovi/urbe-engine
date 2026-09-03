import { CastResolver, QuestlineRuntime } from '../../../../quests/dist/runtime.js';

/**
 * The questlines of a world, running against the game's own simulation
 * (../../../../quests/CONTRACT.md): every role is cast here at load, so the
 * people the story needs are the people walking this city. Player events go to
 * every questline; what each one completes comes back for the HUD.
 */
export class QuestSession {

	/** @param entries [{ definition, runtime }] */
	constructor( entries, sim ) {

		this.entries = entries;
		this.sim = sim;

	}

	/**
	 * @param definitions QuestlineDefinition list, main questline first
	 * @param sim the SimulationPort the runtime reads (SimBridge)
	 * @param timeMin when the cast is resolved: whoever is on duty around now
	 * @param persisted optional game-descriptor quest progress or compact snapshot() entries
	 */
	static create( definitions, sim, timeMin, persisted = [] ) {

		const entries = [];
		const resolver = new CastResolver( sim );
		const saved = new Map( persisted.map( ( entry ) => [ entry.id, entry ] ) );

		for ( const definition of definitions ) {

			const previous = saved.get( definition.id );

			if ( previous ) {

				try {

					const snapshot = this.#persistedRuntime( definition, previous, sim );
					if ( snapshot ) {

						entries.push( {
							definition,
							runtime: QuestlineRuntime.restore( definition, snapshot.cast, sim, snapshot.state )
						} );
						continue;

					}

				} catch ( error ) {

					console.warn( `questline ${definition.id} restore ignored: ${this.#message( error )}` );

				}

			}

			try {

				const cast = resolver.resolve( definition, timeMin );
				entries.push( { definition, runtime: new QuestlineRuntime( definition, cast, sim ) } );

			} catch ( error ) {

				console.warn( `questline ${definition.id} not cast: ${this.#message( error )}` );

			}

		}

		return new QuestSession( entries, sim );

	}

	/** Accepts game-descriptor progress or a compact snapshot() entry. */
	static #persistedRuntime( definition, persisted, sim ) {

		const snapshot = persisted.runtime ?? ( persisted.cast && persisted.state ? persisted : null );
		if ( ! snapshot ) return null;
		if ( persisted.totalSteps !== undefined && persisted.totalSteps !== definition.steps.length ) {

			throw new Error( `step count changed from ${persisted.totalSteps} to ${definition.steps.length}` );

		}

		const roleIds = new Set( definition.roles.map( ( role ) => role.roleId ) );
		const castIds = Object.keys( snapshot.cast ?? {} );
		if ( castIds.length !== roleIds.size || castIds.some( ( id ) => ! roleIds.has( id ) ) ) {

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

	static #message( error ) {

		return error instanceof Error ? error.message : String( error );

	}

	get empty() {

		return this.entries.length === 0;

	}

	hasCastNpc( npcId ) {

		return this.entries.some( ( { runtime } ) => Object.values( runtime.cast ).includes( npcId ) );

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

		} catch {

			// No active step takes the event, or it is gated off right now.
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
	persistenceView() {

		return this.entries.map( ( { definition, runtime } ) => {

			const state = runtime.serialize();
			const status = runtime.status();
			const objective = status === 'completed'
				? runtime.ending()?.epilogue ?? definition.premise
				: runtime.activeSteps().map( ( step ) => this.#hint( step, runtime ) ).join( ' / ' ) || definition.premise;

			return {
				id: definition.id,
				title: definition.title,
				objective,
				state: status === 'completed' ? 'completed' : status === 'stalled' ? 'failed' : 'active',
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

	/** The quests panel's list: every questline with its done and open steps, open ones naming who to find. */
	view() {

		return this.entries.map( ( { definition, runtime } ) => {

			const state = runtime.serialize();
			const status = runtime.status();
			const steps = new Map( definition.steps.map( ( step ) => [ step.stepId, step ] ) );

			return {
				id: definition.id,
				title: definition.title,
				text: status === 'completed' ? runtime.ending()?.epilogue ?? definition.premise : definition.premise,
				state: status === 'completed' ? 'done' : status === 'stalled' ? 'failed' : 'active',
				steps: [
					...state.completedStepIds.map( ( id ) => ( { text: steps.get( id ).narrative.playerHint, done: true } ) ),
					...runtime.activeSteps().map( ( step ) => ( { text: this.#hint( step, runtime ), done: false } ) )
				]
			};

		} );

	}

	/** The open step's hint, with the person it is about named when the target is somebody. */
	#hint( step, runtime ) {

		const roleId = step.target.roleId ?? step.target.fromRoleId;
		if ( ! roleId ) return step.narrative.playerHint;

		const npc = this.sim.getNPC( runtime.cast[ roleId ] );
		return `${step.narrative.playerHint} (${npc.name.given} ${npc.name.family})`;

	}

}
