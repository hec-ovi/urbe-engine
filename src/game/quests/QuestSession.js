import { CastResolver, QuestlineRuntime } from '../../../../quests/dist/index.js';

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
	 */
	static create( definitions, sim, timeMin ) {

		const entries = [];
		const resolver = new CastResolver( sim );

		for ( const definition of definitions ) {

			try {

				const cast = resolver.resolve( definition, timeMin );
				entries.push( { definition, runtime: new QuestlineRuntime( definition, cast, sim ) } );

			} catch ( error ) {

				console.warn( `questline ${definition.id} not cast: ${error.message}` );

			}

		}

		return new QuestSession( entries, sim );

	}

	get empty() {

		return this.entries.length === 0;

	}

	/**
	 * @param event PlayerEvent
	 * @returns what changed: [{ definition, completed: [QuestStep], ending: QuestEnding | null }], only for questlines the event moved
	 */
	advance( event, timeMin ) {

		const moved = [];

		for ( const { definition, runtime } of this.entries ) {

			let result;

			try {

				result = runtime.advance( event, timeMin );

			} catch {

				// no active step of this questline takes the event, or it is gated off right now
				continue;

			}

			const steps = new Map( definition.steps.map( ( step ) => [ step.stepId, step ] ) );
			moved.push( {
				definition,
				completed: result.completedStepIds.map( ( id ) => steps.get( id ) ),
				ending: definition.endings.find( ( e ) => e.endingId === result.endingId ) ?? null
			} );

		}

		return moved;

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
