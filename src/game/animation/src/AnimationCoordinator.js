import { AnimationCoordinationError } from './AnimationError.js';
import {
	REQUIRED_CLIPS,
	actionPlan,
	dialoguePlan,
	neutralSegment,
	requirementsReport
} from './ClipPlans.js';
import { validateInput, validateOutput } from './SchemaBoundary.js';

export class AnimationCoordinator {

	#availableClips;
	#actors = new Map();
	#actions = new Map();

	constructor( config ) {

		validateInput( 'config', config );
		this.#availableClips = new Set( config.catalog.availableClips );
		this.#requireClips( REQUIRED_CLIPS );

		for ( const actor of config.actors ) {

			if ( this.#actors.has( actor.actorId ) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_INPUT', `Duplicate actor ${actor.actorId}` );

			}

			this.#requireClips( [ actor.routine.clipName ] );
			this.#actors.set( actor.actorId, routineState( actor.actorId, actor.routine ) );

		}

		validateOutput( 'snapshot', this.snapshot() );

	}

	requirements() {

		const report = requirementsReport();
		validateOutput( 'report', report );
		return report;

	}

	dispatch( command ) {

		validateInput( 'command', command );

		let outcome;
		switch ( command.kind ) {

			case 'sync-routine':
				outcome = this.#syncRoutine( command );
				break;
			case 'quest-action':
				outcome = this.#startQuestAction( command );
				break;
			case 'dialogue-turn':
				outcome = this.#startDialogue( command );
				break;
			case 'complete':
				outcome = this.#complete( command );
				break;
			case 'interrupt':
				outcome = this.#interrupt( command );
				break;
			case 'resume-routine':
				outcome = this.#resumeRoutine( command );
				break;
			default:
				throw new AnimationCoordinationError( 'E_ANIMATION_INPUT', `Unknown command ${command.kind}` );

		}

		const result = {
			version: '1',
			commandId: command.commandId,
			transitions: outcome.transitions,
			events: outcome.events,
			state: this.snapshot()
		};
		validateOutput( 'result', result );
		return result;

	}

	snapshot() {

		const snapshot = {
			version: '1',
			actors: [ ...this.#actors.values() ]
				.map( clone )
				.sort( byActorId ),
			actions: [ ...this.#actions.values() ]
				.map( clone )
				.sort( byActionId )
		};
		validateOutput( 'snapshot', snapshot );
		return snapshot;

	}

	restore( snapshot ) {

		validateInput( 'snapshot', snapshot );
		this.#validateRestore( snapshot );
		this.#actors = new Map( snapshot.actors.map( ( actor ) => [ actor.actorId, clone( actor ) ] ) );
		this.#actions = new Map( snapshot.actions.map( ( action ) => [ action.actionId, clone( action ) ] ) );
		return this.snapshot();

	}

	#syncRoutine( command ) {

		this.#requireClips( [ command.routine.clipName ] );
		const existing = this.#actors.get( command.actorId );

		if ( ! existing ) {

			const actor = routineState( command.actorId, command.routine );
			this.#actors.set( command.actorId, actor );
			return {
				transitions: [ transition( actor.actorId, 'routine', 'routine', [ routineSegment( actor.routine ) ] ) ],
				events: [ event( 'routine-synchronized', null, [ actor.actorId ] ) ]
			};

		}

		const fromMode = existing.mode;
		existing.routine = clone( command.routine );

		const transitions = [];
		if ( existing.mode === 'routine' ) {

			existing.posture = command.routine.posture;
			existing.currentClip = command.routine.clipName;
			transitions.push( transition(
				existing.actorId,
				fromMode,
				'routine',
				[ routineSegment( existing.routine ) ]
			) );

		}

		return {
			transitions,
			events: [ event( 'routine-synchronized', null, [ existing.actorId ] ) ]
		};

	}

	#startQuestAction( command ) {

		this.#assertNewAction( command.actionId );
		const actor = this.#requireRoutineActor( command.actorId );
		const plan = actionPlan( command.variant );
		if ( ! plan ) throw new AnimationCoordinationError( 'E_ANIMATION_ACTION', `Unknown action variant ${command.variant}` );
		this.#requireClips( [ ...plan.start, ...plan.exit ].map( ( segment ) => segment.clipName ) );

		const fromMode = actor.mode;
		applyPlan( actor, command.actionId, plan );
		this.#actions.set( command.actionId, {
			actionId: command.actionId,
			participants: [ actor.actorId ],
			status: 'active'
		} );

		return {
			transitions: [ transition( actor.actorId, fromMode, 'quest', plan.start ) ],
			events: [ event( 'quest-action-started', command.actionId, [ actor.actorId ] ) ]
		};

	}

	#startDialogue( command ) {

		this.#assertNewAction( command.actionId );
		if ( command.listenerIds.includes( command.speakerId ) ) {

			throw new AnimationCoordinationError( 'E_ANIMATION_INPUT', 'A dialogue speaker cannot listen to the same turn' );

		}

		const listenerIds = [ ...command.listenerIds ].sort();
		const participantIds = [ command.speakerId, ...listenerIds ];
		const actors = participantIds.map( ( actorId ) => this.#requireRoutineActor( actorId ) );
		const transitions = [];

		for ( const actor of actors ) {

			const role = actor.actorId === command.speakerId ? 'talk' : 'listen';
			const plan = dialoguePlan( role, actor.routine.posture );
			if ( ! plan ) {

				throw new AnimationCoordinationError(
					'E_ANIMATION_ACTION',
					`Dialogue has no ${role} plan for ${actor.routine.posture}`
				);

			}
			this.#requireClips( plan.start.map( ( segment ) => segment.clipName ) );
			const fromMode = actor.mode;
			applyPlan( actor, command.actionId, plan );
			transitions.push( transition( actor.actorId, fromMode, 'quest', plan.start ) );

		}

		const sortedParticipants = [ ...participantIds ].sort();
		this.#actions.set( command.actionId, {
			actionId: command.actionId,
			participants: sortedParticipants,
			status: 'active'
		} );

		return {
			transitions,
			events: [ event( 'dialogue-turn-started', command.actionId, sortedParticipants ) ]
		};

	}

	#complete( command ) {

		const action = this.#requireAction( command.actionId, 'active' );
		const transitions = [];

		for ( const actorId of action.participants ) {

			const actor = this.#requireActor( actorId );
			const neutral = neutralSegment( actor.routine.posture );
			this.#requireClips( [ neutral.clipName ] );
			const segments = [ ...actor.exitSegments.map( clone ), neutral ];
			const fromMode = actor.mode;
			actor.mode = 'completed';
			actor.posture = actor.routine.posture;
			actor.completion = null;
			actor.currentClip = neutral.clipName;
			actor.exitSegments = [];
			actor.resumePending = true;
			transitions.push( transition( actor.actorId, fromMode, 'completed', segments ) );

		}

		action.status = 'completed';
		return {
			transitions,
			events: [ event( 'action-completed', action.actionId, action.participants ) ]
		};

	}

	#interrupt( command ) {

		const action = this.#requireAction( command.actionId, 'active' );
		const transitions = [];

		for ( const actorId of action.participants ) {

			const actor = this.#requireActor( actorId );
			const neutral = neutralSegment( actor.routine.posture );
			this.#requireClips( [ neutral.clipName ] );
			const fromMode = actor.mode;
			actor.mode = 'interrupted';
			actor.posture = actor.routine.posture;
			actor.completion = null;
			actor.currentClip = neutral.clipName;
			actor.exitSegments = [];
			actor.resumePending = true;
			transitions.push( transition( actor.actorId, fromMode, 'interrupted', [ neutral ] ) );

		}

		action.status = 'interrupted';
		return {
			transitions,
			events: [ event( 'action-interrupted', action.actionId, action.participants, command.reason ) ]
		};

	}

	#resumeRoutine( command ) {

		const action = this.#actions.get( command.actionId );
		if ( ! action ) throw new AnimationCoordinationError( 'E_ANIMATION_ACTION', `Unknown action ${command.actionId}` );
		if ( action.status === 'active' ) {

			throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Action ${command.actionId} must complete or interrupt before routine resume` );

		}

		const transitions = [];
		for ( const actorId of action.participants ) {

			const actor = this.#requireActor( actorId );
			const fromMode = actor.mode;
			const routine = routineSegment( actor.routine );
			this.#requireClips( [ routine.clipName ] );
			Object.assign( actor, routineState( actor.actorId, actor.routine ) );
			transitions.push( transition( actor.actorId, fromMode, 'routine', [ routine ] ) );

		}

		this.#actions.delete( action.actionId );
		return {
			transitions,
			events: [ event( 'routine-resumed', action.actionId, action.participants ) ]
		};

	}

	#assertNewAction( actionId ) {

		if ( this.#actions.has( actionId ) ) {

			throw new AnimationCoordinationError( 'E_ANIMATION_CONFLICT', `Action ${actionId} already exists` );

		}

	}

	#requireActor( actorId ) {

		const actor = this.#actors.get( actorId );
		if ( ! actor ) throw new AnimationCoordinationError( 'E_ANIMATION_ACTOR', `Unknown actor ${actorId}` );
		return actor;

	}

	#requireRoutineActor( actorId ) {

		const actor = this.#requireActor( actorId );
		if ( actor.mode !== 'routine' ) {

			throw new AnimationCoordinationError( 'E_ANIMATION_CONFLICT', `Actor ${actorId} is already in action ${actor.actionId}` );

		}
		return actor;

	}

	#requireAction( actionId, status ) {

		const action = this.#actions.get( actionId );
		if ( ! action ) throw new AnimationCoordinationError( 'E_ANIMATION_ACTION', `Unknown action ${actionId}` );
		if ( action.status !== status ) {

			throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Action ${actionId} is ${action.status}, expected ${status}` );

		}
		return action;

	}

	#requireClips( clipNames ) {

		const missing = [ ...new Set( clipNames ) ].filter( ( clipName ) => ! this.#availableClips.has( clipName ) ).sort();
		if ( missing.length ) {

			throw new AnimationCoordinationError(
				'E_ANIMATION_CATALOG',
				`Animation catalog is missing required clips: ${missing.join( ', ')}`,
				missing
			);

		}

	}

	#validateRestore( snapshot ) {

		const actorIds = new Set();
		for ( const actor of snapshot.actors ) {

			if ( actorIds.has( actor.actorId ) ) throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Duplicate restored actor ${actor.actorId}` );
			actorIds.add( actor.actorId );
			this.#requireClips( [ actor.currentClip, actor.routine.clipName, ...actor.exitSegments.map( ( segment ) => segment.clipName ) ] );

		}

		const actionIds = new Set();
		const busyActorIds = new Set();
		for ( const action of snapshot.actions ) {

			if ( actionIds.has( action.actionId ) ) throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Duplicate restored action ${action.actionId}` );
			actionIds.add( action.actionId );

			for ( const actorId of action.participants ) {

				if ( busyActorIds.has( actorId ) ) throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Restored actor ${actorId} belongs to multiple actions` );
				busyActorIds.add( actorId );
				const actor = snapshot.actors.find( ( candidate ) => candidate.actorId === actorId );
				if ( ! actor || actor.actionId !== action.actionId || actor.mode === 'routine' || actor.mode !== modeForStatus( action.status ) ) {

					throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Restored action ${action.actionId} disagrees with actor ${actorId}` );

				}

			}

		}

		for ( const actor of snapshot.actors ) {

			if ( actor.mode === 'routine' && ( actor.actionId !== null || actor.action !== null || actor.resumePending ) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Routine actor ${actor.actorId} carries action state` );

			}
			if ( actor.mode === 'routine' && (
				actor.currentClip !== actor.routine.clipName ||
				actor.completion !== null ||
				actor.exitSegments.length > 0 ||
				actor.posture !== actor.routine.posture
			) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Routine actor ${actor.actorId} disagrees with its synchronized routine` );

			}
			if ( actor.mode !== 'routine' && ! busyActorIds.has( actor.actorId ) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Busy actor ${actor.actorId} has no restored action` );

			}
			if ( actor.mode !== 'routine' && ( actor.actionId === null || actor.action === null || ! actor.resumePending ) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Busy actor ${actor.actorId} lacks resumable action state` );

			}
			if ( actor.mode === 'quest' && actor.completion === null ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Active actor ${actor.actorId} lacks a completion trigger` );

			}
			if ( ( actor.mode === 'completed' || actor.mode === 'interrupted' ) && (
				actor.completion !== null || actor.exitSegments.length > 0
			) ) {

				throw new AnimationCoordinationError( 'E_ANIMATION_STATE', `Settled actor ${actor.actorId} carries active transition state` );

			}

		}

	}

}

function routineState( actorId, routine ) {

	return {
		actorId,
		mode: 'routine',
		actionId: null,
		action: null,
		posture: routine.posture,
		completion: null,
		currentClip: routine.clipName,
		exitSegments: [],
		resumePending: false,
		routine: clone( routine )
	};

}

function applyPlan( actor, actionId, plan ) {

	actor.mode = 'quest';
	actor.actionId = actionId;
	actor.action = plan.action;
	actor.posture = plan.posture;
	actor.completion = plan.completion;
	actor.currentClip = plan.start.at( -1 ).clipName;
	actor.exitSegments = plan.exit.map( clone );
	actor.resumePending = true;

}

function routineSegment( routine ) {

	return {
		clipName: routine.clipName,
		loop: routine.loop,
		role: 'routine',
		blendMs: 160
	};

}

function transition( actorId, fromMode, toMode, segments ) {

	return {
		actorId,
		fromMode,
		toMode,
		segments: segments.map( clone ),
		terminalClip: segments.at( -1 ).clipName
	};

}

function event( type, actionId, actorIds, reason = null ) {

	return {
		type,
		actionId,
		actorIds: [ ...actorIds ].sort(),
		reason
	};

}

function modeForStatus( status ) {

	if ( status === 'active' ) return 'quest';
	if ( status === 'completed' ) return 'completed';
	return 'interrupted';

}

function clone( value ) {

	return structuredClone( value );

}

function byActorId( a, b ) {

	return a.actorId.localeCompare( b.actorId );

}

function byActionId( a, b ) {

	return a.actionId.localeCompare( b.actionId );

}
