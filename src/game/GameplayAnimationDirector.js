import { AnimationCoordinator } from './animation/index.js';

const PLAYER_ID = 'player';
const LOOP_HOLD_SECONDS = 1.8;
const CLIP_BY_ANIMATION = Object.freeze( {
	walk: 'Walk_Loop', run: 'Sprint_Loop', idle: 'Idle_Loop',
	sit: 'Sitting_Idle_Loop', crouch: 'Crouch_Idle_Loop'
} );
const QUEST_VARIANT = Object.freeze( {
	take: 'pickup-ground', read: 'read', inspect: 'observe', steal: 'steal-ground',
	work: 'work-interact', deliver: 'deliver'
} );

/**
 * Game composition for the schema-validated animation coordinator. It turns
 * live continuity and accepted quest events into exact Pro clip transitions,
 * then projects every transition onto Crowd and the one focused armature.
 */
export class GameplayAnimationDirector {

	constructor( { catalog, animation, crowd, hero } ) {

		this.crowd = crowd;
		this.hero = hero;
		this.duration = new Map( ( animation?.animations ?? [] ).map( ( clip ) => [ clip.name, clip.duration ] ) );
		this.sequence = 0;
		this.routines = new Map();
		this.actualIds = new Map();
		this.actions = new Map();
		this.actorActions = new Map();
		this.conversations = new WeakMap();
		this.timed = new Map();
		this.physicsActors = new Set();
		this.focus = null;
		this.coordinator = new AnimationCoordinator( {
			version: '1', catalog,
			actors: [ { actorId: PLAYER_ID, routine: playerRoutine() } ]
		} );

	}

	/** Synchronizes visible continuity actors and live follow animation state. */
	update( actors, deltaSeconds ) {

		const byNpcId = new Map( actors.map( ( actor ) => [ actor.npcId, actor ] ) );
		for ( const actor of [ ...actors ].sort( ( left, right ) => left.npcId.localeCompare( right.npcId ) ) ) {

			const actorId = this.#actorId( actor.npcId );
			if ( this.physicsActors.has( actorId ) ) continue;
			let held = this.actorActions.get( actorId );
			if ( actor.mode === 'posing' ) {

				this.#ensureCrouchActor( actorId );
				if ( held?.kind !== 'crouch' ) {

					if ( held ) this.#settle( held.actionId, 'interrupt', 'dialogue-replaced', false );
					this.#startQuest( actorId, 'crouch-idle', 'crouch', actor.npcId );

				}
				continue;

			}
			this.#syncActor( actor );
			held = this.actorActions.get( actorId );
			if ( held?.kind === 'crouch' ) {

				this.#settle( held.actionId, 'complete', null, true, actor.npcId );
				held = null;

			}
			if ( actor.mode === 'following' ) {

				const variant = followVariant( actor.animation );
				if ( variant && ( held?.kind !== 'follow' || held.variant !== variant ) ) {

					if ( held ) this.#settle( held.actionId, 'complete', null, false );
					this.#startQuest( this.#actorId( actor.npcId ), variant, 'follow', actor.npcId );

				}

			} else if ( held?.kind === 'follow' ) {

				this.#settle( held.actionId, actor.mode === 'released' ? 'interrupt' : 'complete',
					actor.mode === 'released' ? 'target-unavailable' : null, true, actor.npcId );

			}

		}

		for ( const [ actionId, remaining ] of [ ...this.timed ] ) {

			const next = remaining - deltaSeconds;
			if ( next > 0 ) this.timed.set( actionId, next );
			else {

				this.timed.delete( actionId );
				this.#settle( actionId, 'complete', null, true );

			}

		}

		if ( this.focus && ! byNpcId.get( this.focus.npcId )?.visible ) {

			this.hero.hide();
			this.focus = null;

		}

	}

	/** Interrupts any coordinated action before Rapier takes the actor's rig. */
	physicsInterrupt( person ) {

		const identity = person?.npcId ?? person?.crowdId ?? ( person?.id ? `crowd:${person.id}` : null );
		if ( ! identity ) return null;
		const actorId = this.#actorId( identity );
		this.physicsActors.add( actorId );
		const held = this.actorActions.get( actorId );
		if ( this.focus?.npcId === identity ) this.focus = null;
		return held ? this.#settle( held.actionId, 'interrupt', 'physics', false ) : null;

	}

	/** Allows the next continuity update to resume the latest routine. */
	physicsResume( person ) {

		const identity = person?.npcId ?? person?.crowdId ?? ( person?.id ? `crowd:${person.id}` : null );
		if ( ! identity ) return false;
		return this.physicsActors.delete( this.#actorId( identity ) );

	}

	/** Applies one accepted, cast-only NPC pose control event. */
	npcControl( request, actor ) {

		if ( ! actor?.npcId ) return null;
		const actorId = this.#actorId( actor.npcId );
		if ( request.kind === 'start-crouch' ) {

			this.#ensureCrouchActor( actorId );
			this.#replaceParticipants( [ actorId ] );
			return this.#startQuest( actorId, 'crouch-idle', 'crouch', actor.npcId );

		}
		if ( request.kind !== 'release-crouch' ) return null;
		this.#syncActor( actor );
		const held = this.actorActions.get( actorId );
		return held?.kind === 'crouch'
			? this.#settle( held.actionId, 'complete', null, true, actor.npcId )
			: null;

	}

	/** Registers an open conversation without claiming either participant is speaking. */
	beginConversation( conversation, actor ) {

		if ( ! conversation?.npcId || ! actor ) return null;
		const actorId = this.#syncActor( actor );
		this.#replaceParticipants( [ PLAYER_ID, actorId ] );
		this.conversations.set( conversation, { actorId, npcId: conversation.npcId, actionId: null } );
		return { actorId, npcId: conversation.npcId };

	}

	/** Atomically changes the current turn to player speaking and NPC listening. */
	playerDialogueTurn( conversation ) {

		return this.#nextTurn( conversation, PLAYER_ID );

	}

	/** Atomically changes the current turn to NPC speaking and player listening. */
	npcDialogueTurn( conversation ) {

		const state = this.conversations.get( conversation );
		return state ? this.#nextTurn( conversation, state.actorId ) : null;

	}

	/** Completes the audible turn while leaving the conversation open. */
	completeDialogueTurn( conversation ) {

		const state = this.conversations.get( conversation );
		if ( ! state?.actionId ) return null;
		const result = this.#settle( state.actionId, 'complete', null, true, state.npcId );
		state.actionId = null;
		return result;

	}

	/** Interrupts the open turn and restores the continuity actor's current routine. */
	endConversation( conversation, actor, reason = 'player-left' ) {

		const state = this.conversations.get( conversation );
		if ( ! state ) return null;
		if ( actor ) this.#syncActor( actor );
		const result = state.actionId
			? this.#settle( state.actionId, 'interrupt', reason, true, state.npcId )
			: null;
		this.conversations.delete( conversation );
		if ( actor?.mode === 'following' ) {

			const variant = followVariant( actor.animation );
			if ( variant ) return this.#startQuest( state.actorId, variant, 'follow', state.npcId );

		}
		return result;

	}

	/** Starts presentation only after QuestActions accepted the exact action. */
	questInteraction( { targetKey, action, members = [] } ) {

		if ( action === 'listen' ) {

			if ( members.length === 0 ) return null;
			const actorIds = members.map( ( member ) => this.#syncMember( member ) );
			this.#replaceParticipants( [ PLAYER_ID, ...actorIds ] );
			const started = this.#dialogue( actorIds[ 0 ], [ PLAYER_ID, ...actorIds.slice( 1 ) ], members[ 0 ].npcId, 'quest' );
			this.#time( started.actionId, started.transitions );
			return { ...started, variant: 'listen' };

		}
		const variant = QUEST_VARIANT[ action ];
		if ( ! variant ) return null;
		this.#replaceParticipants( [ PLAYER_ID ] );
		const started = this.#startQuest( PLAYER_ID, variant, 'quest', null, targetKey );
		this.#time( started.actionId, started.transitions );
		return { ...started, variant };

	}

	snapshot() {

		return this.coordinator.snapshot();

	}

	#nextTurn( conversation, speakerId ) {

		const state = this.conversations.get( conversation );
		if ( ! state ) return null;
		if ( state.actionId ) this.#settle( state.actionId, 'complete', null, false );
		const listeners = speakerId === PLAYER_ID ? [ state.actorId ] : [ PLAYER_ID ];
		const started = this.#dialogue( speakerId, listeners, state.npcId );
		state.actionId = started.actionId;
		return started;

	}

	#dialogue( speakerId, listenerIds, focusNpcId, kind = 'conversation' ) {

		const actionId = this.#id( `${kind}:turn` );
		const result = this.coordinator.dispatch( {
			version: '1', commandId: this.#id( 'dialogue' ), kind: 'dialogue-turn',
			actionId, speakerId, listenerIds
		} );
		this.#track( actionId, kind, 'dialogue', [ speakerId, ...listenerIds ] );
		this.#render( result, focusNpcId, kind );
		return { ...result, actionId };

	}

	#startQuest( actorId, variant, kind, focusNpcId, stableKey = variant ) {

		const actionId = this.#id( `${kind}:${safePart( stableKey )}` );
		const result = this.coordinator.dispatch( {
			version: '1', commandId: this.#id( 'quest' ), kind: 'quest-action',
			actionId, actorId, variant
		} );
		this.#track( actionId, kind, variant, [ actorId ] );
		this.#render( result, focusNpcId, kind );
		return { ...result, actionId };

	}

	#replaceParticipants( actorIds ) {

		for ( const actorId of new Set( actorIds ) ) {

			const active = this.actorActions.get( actorId );
			if ( active ) this.#settle( active.actionId, 'interrupt', 'dialogue-replaced', false );

		}

	}

	#settle( actionId, lifecycle, reason, render, focusNpcId = null ) {

		const tracked = this.actions.get( actionId );
		if ( ! tracked ) return null;
		const closed = this.coordinator.dispatch( {
			version: '1', commandId: this.#id( lifecycle ), kind: lifecycle, actionId,
			...( lifecycle === 'interrupt' ? { reason } : {} )
		} );
		const resumed = this.coordinator.dispatch( {
			version: '1', commandId: this.#id( 'resume' ), kind: 'resume-routine', actionId
		} );
		const result = resumedAfter( closed, resumed );
		for ( const actorId of tracked.actorIds ) this.actorActions.delete( actorId );
		this.actions.delete( actionId );
		this.timed.delete( actionId );
		if ( render ) this.#render( result, focusNpcId ?? tracked.focusNpcId, 'routine' );
		return result;

	}

	#syncMember( member ) {

		const actorId = this.#actorId( member.npcId );
		const posture = member.clip === 3 || member.clip === 4 ? 'seated' : 'standing';
		this.#sync( actorId, {
			routineId: `quest:${posture}`, activity: posture === 'seated' ? 'sit' : 'idle', posture,
			clipName: posture === 'seated' ? 'Sitting_Idle_Loop' : 'Idle_Loop', loop: true
		} );
		return actorId;

	}

	#syncActor( actor ) {

		const actorId = this.#actorId( actor.npcId );
		this.#sync( actorId, routineFor( actor ) );
		return actorId;

	}

	#ensureCrouchActor( actorId ) {

		if ( this.routines.has( actorId ) ) return;
		this.#sync( actorId, {
			routineId: 'npc:pre-crouch', activity: 'idle', posture: 'standing', clipName: 'Idle_Loop', loop: true
		} );

	}

	#sync( actorId, routine ) {

		const key = JSON.stringify( routine );
		if ( this.routines.get( actorId ) === key ) return null;
		const result = this.coordinator.dispatch( {
			version: '1', commandId: this.#id( 'routine' ), kind: 'sync-routine', actorId, routine
		} );
		this.routines.set( actorId, key );
		this.#render( result, null, 'routine' );
		return result;

	}

	#track( actionId, kind, variant, actorIds ) {

		const focusNpcId = actorIds.map( ( id ) => this.actualIds.get( id ) ).find( Boolean ) ?? null;
		const tracked = { actionId, kind, variant, actorIds: [ ...actorIds ], focusNpcId };
		this.actions.set( actionId, tracked );
		for ( const actorId of actorIds ) this.actorActions.set( actorId, tracked );

	}

	#time( actionId, transitions ) {

		let seconds = 0;
		for ( const transition of transitions ) for ( const segment of transition.segments ) {

			seconds += segment.loop ? LOOP_HOLD_SECONDS : Math.max( 0.1, this.duration.get( segment.clipName ) ?? 0.8 );

		}
		this.timed.set( actionId, Math.max( LOOP_HOLD_SECONDS, seconds ) );

	}

	#render( result, focusNpcId, focusKind ) {

		for ( const transition of result.transitions ) {

			const npcId = this.actualIds.get( transition.actorId );
			if ( npcId ) this.crowd.setAnimationClip( npcId, transition.terminalClip );

		}
		if ( ! focusNpcId ) return;
		const transition = result.transitions.find( ( candidate ) => this.actualIds.get( candidate.actorId ) === focusNpcId );
		const person = this.crowd.memberForNpc( focusNpcId );
		if ( ! transition || ! person ) return;
		this.focus = { npcId: focusNpcId, kind: focusKind };
		Promise.resolve( this.hero.show( person, transition.segments ) )
			.catch( ( error ) => console.warn( 'focused character:', error.message ) );

	}

	#actorId( npcId ) {

		const actorId = validId( npcId ) ? npcId : `npc:${hash( npcId )}`;
		const present = this.actualIds.get( actorId );
		if ( present && present !== npcId ) throw new Error( `animation actor id collision for ${npcId}` );
		this.actualIds.set( actorId, npcId );
		return actorId;

	}

	#id( label ) {

		return `animation:${++ this.sequence}:${safePart( label )}`;

	}

}

function playerRoutine() {

	return { routineId: 'player:first-person', activity: 'idle', posture: 'standing', clipName: 'Idle_Loop', loop: true };

}

function routineFor( actor ) {

	const clipName = CLIP_BY_ANIMATION[ actor.animation ] ?? 'Idle_Loop';
	const posture = actor.animation === 'sit' ? 'seated' : 'standing';
	const activity = actor.animation === 'run' ? 'sprint'
		: actor.animation === 'walk' ? ( actor.mode === 'resuming' ? 'travel' : 'walk' )
			: actor.animation === 'sit' ? 'sit' : 'idle';
	const entry = Number.isInteger( actor.schedule?.entryIndex ) ? actor.schedule.entryIndex : 0;
	return {
		routineId: `npc:${safePart( actor.mode )}:${entry}:${safePart( actor.animation )}`,
		activity, posture, clipName, loop: true
	};

}

function followVariant( animation ) {

	if ( animation === 'run' ) return 'follow-sprint';
	if ( animation === 'walk' ) return 'follow-walk';
	return 'idle';

}

function resumedAfter( closed, resumed ) {

	return {
		...resumed,
		transitions: resumed.transitions.map( ( transition ) => {

			const closing = closed.transitions.find( ( candidate ) => candidate.actorId === transition.actorId );
			const exits = closing?.segments.filter( ( segment ) => segment.role === 'exit' ) ?? [];
			const segments = [ ...exits, ...transition.segments ];
			return { ...transition, segments, terminalClip: segments.at( -1 ).clipName };

		} ),
		events: [ ...closed.events, ...resumed.events ]
	};

}

function validId( value ) {

	return typeof value === 'string' && value.length <= 160 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test( value );

}

function safePart( value ) {

	const safe = String( value ).replace( /[^A-Za-z0-9._:-]/g, '_' ).slice( 0, 80 );
	return safe && /^[A-Za-z0-9]/.test( safe ) ? safe : `id:${hash( String( value ) )}`;

}

function hash( value ) {

	let first = 2166136261;
	let second = 2246822519;
	for ( let index = 0; index < value.length; index ++ ) {

		first = Math.imul( first ^ value.charCodeAt( index ), 16777619 );
		second = Math.imul( second ^ value.charCodeAt( value.length - 1 - index ), 3266489917 );

	}
	return `${( first >>> 0 ).toString( 16 ).padStart( 8, '0' )}${( second >>> 0 ).toString( 16 ).padStart( 8, '0' )}`;

}
