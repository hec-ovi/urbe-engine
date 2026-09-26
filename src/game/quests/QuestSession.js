import { CastResolver, QuestlineRuntime, StepStamp, StoryVenues } from '../../../../quests/dist/runtime.js';
import { castIds, castRole, characterName } from './QuestCast.js';
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
	constructor( entries, sim, blocked = [], presence = { read: null } ) {

		this.entries = entries;
		this.sim = sim;
		this.blocked = blocked;
		this.presence = presence;

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
		const presence = { read: null };
		const runtimeSim = physicalSimulation( sim, presence );
		const stamped = definitions.map( ( carried ) => stamp ? stamp.definition( carried ) : carried );
		const restored = new Map();
		const repairedStates = new Map();
		const owners = new Map();

		// Reserve every valid saved character before filling any new questline,
		// including a newly added main story that appears before a saved side job.
		for ( const definition of stamped ) {

			const previous = saved.get( definition.id );
			if ( ! previous ) continue;
			try {

				const snapshot = this.#persistedRuntime( definition, previous, sim );
				if ( ! snapshot ) continue;
				const runtime = QuestlineRuntime.restore( definition, snapshot.cast, runtimeSim, snapshot.state );
				let repair = false;
				for ( const role of definition.roles ) {

					const character = `${role.roleId}:${role.npcType}`;
					const npcId = snapshot.cast[ role.roleId ];
					if ( owners.has( npcId ) && owners.get( npcId ) !== character ||
						characters.has( character ) && characters.get( character ) !== npcId ) {

						repair = true;
						continue;

					}
					owners.set( npcId, character );
					characters.set( character, npcId );
					taken.add( npcId );

				}
				// Older saves could assign several different characters one body.
				// Recast only the conflicting identities, keeping quest progress.
				if ( repair ) repairedStates.set( definition.id, snapshot.state );
				else restored.set( definition.id, runtime );

			} catch ( error ) {

				console.warn( `questline ${definition.id} restore ignored: ${this.#message( error )}` );

			}

		}

		for ( const [ index, definition ] of stamped.entries() ) {

			// The main questline is written first; everything after it is a side job.
			const side = index > 0;
			if ( restored.has( definition.id ) ) {

				entries.push( { definition, side, runtime: restored.get( definition.id ) } );
				continue;

			}

			try {

				// Where a step happens is settled when the questline is built,
				// so the bundle's own parcels are the ones played; the cast
				// only says who stands there.
				const result = resolver.cast( definition, timeMin, { taken, characters } );
				if ( result.blocked ) {

					this.#block( blocked, definition, castBlockReason( result.blocked ) );
					continue;

				}
				const runtime = repairedStates.has( definition.id )
					? QuestlineRuntime.restore( definition, result.cast, runtimeSim, repairedStates.get( definition.id ) )
					: new QuestlineRuntime( definition, result.cast, runtimeSim );
				entries.push( { definition, side, runtime } );
				for ( const npcId of Object.values( result.cast ) ) taken.add( npcId );

			} catch ( error ) {

				this.#block( blocked, definition, this.#message( error ) );

			}

		}

		return new QuestSession( entries, sim, blocked, presence );

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

	/** Story-facing name, without mutating the simulation's person or any bystander. */
	characterName( npcId ) {

		for ( const { runtime } of this.entries ) {

			const name = characterName( runtime, npcId );
			if ( name ) return { ...name };

		}
		return null;

	}

	/** The persona of the role this exact identity plays in the first questline that casts it, or null. */
	persona( npcId ) {

		for ( const { runtime } of this.entries ) {

			const persona = castRole( runtime, npcId )?.persona;
			if ( persona ) return persona;

		}
		return null;

	}

	/** Actual controlled bodies override their interrupted routine for presence only. */
	setPresenceSource( read ) {

		this.presence.read = read;

	}

	/** A parcel appointment can be staffed before schedule-based presence is true. */
	canPlaceCast( questId, stepId, timeMin ) {

		const entry = this.entries.find( ( candidate ) => candidate.definition.id === questId );
		return entry?.runtime.stepPlacementAvailability( stepId, timeMin ).available ?? false;

	}

	/** Whether an open step still wants this person where the player found them. */
	holdsCast( npcId ) {

		return this.entries.some( ( { runtime } ) => runtime.activeSteps()
			.some( ( step ) => castIds( step.target, runtime ).includes( npcId ) ) );

	}

	/** Authored, explicit conversation choices for this exact living cast identity. */
	dialoguesFor( npcId, timeMin ) {

		return this.entries.flatMap( ( { definition, runtime } ) => runtime.activeSteps().flatMap( step => {

			const dialogue = runtime.dialogueFor( step.stepId, npcId, timeMin );
			return dialogue ? [ { ...dialogue, title: definition.title, objective: step.narrative.playerHint } ] : [];

		} ) );

	}

	chooseDialogue( questId, stepId, npcId, choiceId, timeMin ) {

		const entry = this.entries.find( entry => entry.definition.id === questId );
		if ( ! entry ) return { accepted: false, reason: 'stale' };
		const result = entry.runtime.chooseDialogue( stepId, npcId, choiceId, timeMin );
		if ( ! result.accepted || ! result.advanceResult ) return result;
		return { ...result, change: {
			definition: entry.definition,
			completed: entry.definition.steps.filter( step => result.advanceResult.completedStepIds.includes( step.stepId ) ),
			ending: entry.definition.endings.find( ending => ending.endingId === result.advanceResult.endingId ) ?? null
		} };

	}

	/** A returning player hears the last accepted lead instead of the introduction again. */
	conversationRecap( npcId ) {

		for ( const { definition, runtime } of this.entries ) {

			const completed = new Set( runtime.serialize().completedStepIds );
			const step = [ ...definition.steps ].reverse().find( step => completed.has( step.stepId )
				&& step.target.kind === 'talk' && runtime.cast[ step.target.roleId ] === npcId && step.dialogue );
			const choice = step?.dialogue.choices.find( choice => choice.completesStep );
			if ( choice ) return {
				questId: definition.id, stepId: step.stepId, title: definition.title, reply: choice.reply,
				questions: step.endingId ? [] : step.dialogue.choices.filter( choice => ! choice.completesStep )
			};

		}
		return null;

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
			const journalStep = ( step, options = {} ) => ( {
				...stepView( { step, runtime, sim: this.sim, timeMin, ...options } ),
				...( step.endingId ? {
					endingId: step.endingId,
					endingTitle: definition.endings.find( ( ending ) => ending.endingId === step.endingId )?.title,
					...( step.target.kind === 'talk' ? { commitment: step.dialogue?.choices.find( ( choice ) => choice.completesStep )?.text
						?? `I'm ready: ${definition.endings.find( ( ending ) => ending.endingId === step.endingId )?.title}.` } : {} ),
					stake: step.narrative.stake
				} : {} )
			} );

			return {
				id: definition.id,
				title: definition.title,
				text: status === 'completed' ? runtime.ending()?.epilogue ?? definition.premise : definition.premise,
				...( definition.prologue ? { prologue: definition.prologue } : {} ),
				state: this.#state( entry, status, state, 'done' ),
				steps: [
					...state.completedStepIds.map( ( id ) => journalStep( steps.get( id ), { done: true } ) ),
					...runtime.activeSteps().map( ( step ) => journalStep( step ) ),
					...cancelledJournalSteps( definition, state ).map( ( step ) => journalStep( step, { cancelled: true } ) )
				]
			};

		} ).concat( this.blocked.map( ( entry ) => ( {
			id: entry.id, title: entry.title, text: entry.text, state: 'blocked', note: entry.reason, steps: []
		} ) ) );

	}

	/** What a new game opens on: the main questline's prologue as `{ title, text }`, or null when it has none. */
	prologue() {

		const main = this.entries.find( ( entry ) => ! entry.side )?.definition;
		return main?.prologue ? { title: main.title, text: main.prologue } : null;

	}

	/** A side job nobody has started yet is on offer, not under way. */
	#state( { side }, status, state, completedWord ) {

		if ( status === 'completed' ) return completedWord;
		if ( status === 'stalled' ) return 'failed';
		return side && state.completedStepIds.length === 0 ? 'available' : 'active';

	}

}

/** Ending a quest closes other known open paths. Never guess whether a conditional edge opened. */
function cancelledJournalSteps( definition, state ) {

	if ( ! state.endingId ) return [];
	const steps = new Map( definition.steps.map( ( step ) => [ step.stepId, step ] ) );
	const open = new Set( definition.entryStepIds );
	for ( const id of state.completedStepIds ) {

		open.delete( id );
		const step = steps.get( id );
		if ( step.branching !== 'parallel' ) continue;
		for ( const edge of step.next ) if ( edge.when.length === 0 ) open.add( edge.toStepId );

	}
	return [ ...open ].filter( ( id ) => ! state.completedStepIds.includes( id ) ).map( ( id ) => steps.get( id ) );

}

/** The quests box's cast block, in one line for the log. */
function castBlockReason( block ) {

	return `role ${block.roleId} (${block.npcType}) cannot be cast: ${block.reason}`;

}

/** Keep the simulation authoritative for identities, routines and consequences;
 * the host's exact, retained body is authoritative for where a conversation is.
 */
function physicalSimulation( sim, presence ) {

	return new Proxy( sim, {
		get( target, key ) {

			if ( key === 'behaviorAt' ) return ( npcId, timeMin ) => {

				const routine = sim.behaviorAt( npcId, timeMin );
				const actual = presence.read?.( npcId );
				if ( ! actual || ! routine ) return routine;
				return { ...routine, place: { ...actual.place }, mode: 'interior', activity: actual.activity, interrupted: true };

			};
			const value = Reflect.get( target, key, target );
			return typeof value === 'function' ? value.bind( target ) : value;

		}
	} );

}
