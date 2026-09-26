import * as THREE from 'three/webgpu';
import { guidanceFor } from '../../../../quests/dist/runtime.js';
import { QuestActions } from './QuestActions.js';
import { QuestActionBoundary } from './QuestActionBoundary.js';
import { QuestMechanics } from './QuestMechanics.js';

const PHYSICAL_REACH = { pickup: 2.5, steal: 2, listen: 8 };
const AREA_REACH = 3.2;
const MIN_AIM = 0.76;
const CHEST = 1.3;
/** Where a quest mark floats: clear of the tallest head, still inside a room. */
const HEAD = 2.15;
/** Drawn over the room it stands in, so a person indoors is found from the door. */
const MARK_RENDER_ORDER = 12;
/** A mark holds its screen size out to this reach, then stops growing. */
const MARK_REFERENCE = 5;
const MARK_MAX_SCALE = 5;
const FIXED_KINDS = new Set( [ 'rescue', 'access', 'hacking', 'sabotage' ] );
/** Steps that send the player somewhere and read as nothing there without a mark. */
const PLACE_KINDS = new Set( [ 'goto', 'talk' ] );
const MARKED_KINDS = new Set( [ 'pickup', 'work', 'deliver', ...PLACE_KINDS, ...FIXED_KINDS ] );
const ESCORT_REACH = 3.2;

/**
 * Live projection of QuestActions targets into scene marks and centered
 * interactions. The runtime remains authoritative: this class only supplies
 * measured place and focus facts to the validated perform() boundary.
 */
export class QuestGameplay {

	constructor( {
		session, actions, world, crowd, physics, playerCollider, materialFactory, missionItems,
		continuity = null, animations = null, mechanics = null
	} ) {

		this.boundary = new QuestActionBoundary();
		this.boundary.input( 'gameplay-world', world );
		this.actions = actions ?? new QuestActions( session );
		this.mechanics = mechanics ?? ( session ? new QuestMechanics( session ) : null );
		this.session = session;
		this.crowd = crowd;
		this.continuity = continuity;
		this.animations = animations;
		this.physics = physics;
		this.playerCollider = playerCollider;
		this.materialFactory = materialFactory;
		this.missionItems = missionItems;
		this.group = new THREE.Group();
		this.group.name = 'quest-targets';
		this.anchors = new Map( world.parcels.map( ( parcel ) => [ parcel.id, new THREE.Vector3( ...parcel.anchor ) ] ) );
		this.staticMarks = new Map();
		this.targetColliders = new Map();
		this.actorMarks = new Map();
		this.changedTargets = new Set();
		this.liveInteractions = new Map();
		this.escort = null;
		this.transitQuest = null;
		this.mechanicResults = [];
		this.session?.setPresenceSource?.( ( npcId ) => {

			const member = this.crowd.memberForNpc?.( npcId );
			if ( ! member || member.fallen || member.retiring || ! member.parcelId ) return null;
			if ( ! [ 'posing', 'conversation' ].includes( member.controlMode ) && ! ( member.quest && member.stationary && ! member.continuity ) ) return null;
			const activity = [ 'home', 'working', 'shopping', 'leisure' ].includes( member.activity ) ? member.activity : 'leisure';
			return { place: { kind: 'parcel', id: member.parcelId }, activity };

		} );

	}

	/** Explicit engine control event for an actual NPC already cast in this quest session. */
	control( request ) {

		this.boundary.input( 'npc-control-request', request );
		if ( ! this.session?.hasCastNpc( request.npcId ) ) {

			return this.#controlFailure( request, 'not_cast', `NPC ${request.npcId} is not in the active quest cast` );

		}
		if ( ! this.continuity ) return this.#controlFailure( request, 'unavailable', 'NPC continuity is unavailable' );
		let actor;
		try {

			if ( request.kind === 'start-follow' ) {

				actor = this.continuity.startFollow( {
					npcId: request.npcId,
					timeMin: request.timeMin,
					playerPosition: array3( request.playerPosition )
				} );

			} else if ( request.kind === 'release-follow' ) {

				const companion = this.continuity.companion;
				if ( companion?.npcId !== request.npcId || companion.mode !== 'following' ) {

					return this.#controlFailure( request, 'conflict', `NPC ${request.npcId} is not following` );

				}
				actor = this.continuity.stopFollow( { timeMin: request.timeMin } );

			} else if ( request.kind === 'start-crouch' ) {

				actor = this.continuity.startCrouch( {
					npcId: request.npcId,
					timeMin: request.timeMin
				} );

			} else {

				const pose = this.continuity.serialize().pose;
				if ( pose?.npcId !== request.npcId || pose.kind !== 'crouch' ) {

					return this.#controlFailure( request, 'conflict', `NPC ${request.npcId} is not explicitly crouched` );

				}
				actor = this.continuity.releaseCrouch( {
					npcId: request.npcId,
					timeMin: request.timeMin
				} );

			}
			if ( actor.mode === 'released' ) {

				return this.#controlFailure( request, 'unavailable', `NPC ${request.npcId} was released because it became unavailable` );

			}
			this.crowd.syncActor( actor, vector3( request.playerPosition ) );
			this.animations?.npcControl( request, actor );
			return this.boundary.output( 'npc-control-result', {
				ok: true, kind: request.kind, npcId: request.npcId, mode: actor.mode
			} );

		} catch ( error ) {

			return this.#controlFailure( request, controlError( error ), messageOf( error ) );

		}

	}

	/**
	 * The objective the player is following: the chosen questline, else the
	 * first open one. While its escort is under way the step sends the player
	 * where the escort goes, not where it began.
	 */
	objective( timeMin, questId = null, stepId = null ) {

		const objective = this.actions.objective( { timeMin, ...( questId ? { questId } : {} ), ...( stepId ? { stepId } : {} ) } );
		const escort = this.escort?.target;
		if ( ! objective || escort?.questId !== objective.questId || escort.stepId !== objective.stepId ) return objective;
		const to = runtimePlace( escort.target.to );
		return this.boundary.output( 'active-objective', {
			...objective, place: to, venue: escort.target.to.name ?? null,
			guidance: guidanceFor( objective.questId, objective.stepId, to )
		} );

	}

	/** Every active goto and talk step of every questline. */
	places( timeMin ) {

		return this.actions.places( { timeMin } );

	}

	/** Whether an open step still wants this person where the player found them. */
	holdsCast( npcId ) {

		return this.session?.holdsCast( npcId ) ?? false;

	}

	/** Whether the escort under way walks with this person. */
	escorts( npcId ) {

		return this.escort?.target.actorIds[ 0 ] === npcId;

	}

	/** The same authored cast label used by the objective and dialogue prompt. */
	characterName( npcId ) {

		return this.session?.characterName( npcId ) ?? null;

	}

	/** Candidates consumed by the shared door, lift, NPC and quest Interactor. */
	candidates( frame ) {

		this.boundary.input( 'gameplay-frame', frame );
		const { timeMin, playerPlaces } = frame;
		const feet = vector3( frame.feet );
		const eye = vector3( frame.eye );
		const look = vector3( frame.look );
		let targets = this.actions.targets( { timeMin } );
		const mechanics = this.#mechanicTargets( timeMin ).map( ( target ) => this.#presentMechanic( target ) );
		let places = this.actions.places( { timeMin } );
		this.#advanceEscort( mechanics, { timeMin, playerPlaces, feet } );
		this.#advanceTransit( mechanics, { timeMin, playerPlaces, feet } );
		this.#materializePassiveCast( mechanics, { timeMin, playerPlaces, feet } );
		this.#materializePlaceCast( [ ...places, ...targets.filter( ( target ) => target.kind === 'listen' ) ], { timeMin, feet, eye } );
		// Posting updates physical presence. Project it in this frame so the
		// interaction, quest log and map all agree with the body just created.
		targets = this.actions.targets( { timeMin } );
		places = this.actions.places( { timeMin } );
		this.#sync( [ ...targets, ...mechanics, ...places ] );
		const candidates = [];
		this.liveInteractions.clear();

		for ( const target of [ ...targets ].sort( ( left, right ) => left.targetKey.localeCompare( right.targetKey ) ) ) {

			if ( ! target.availability.available || this.changedTargets.has( target.targetKey ) ) continue;
			const interaction = this.#interaction( target, { timeMin, playerPlaces, feet, eye, look } );
			if ( ! interaction ) continue;
			this.liveInteractions.set( target.targetKey, interaction );
			candidates.push( {
				kind: 'quest', aim: Math.max( - 1, Math.min( 1, interaction.aim ) ),
				interaction: { targetKey: target.targetKey, prompt: interaction.prompt }
			} );

		}
		for ( const target of mechanics.filter( ( candidate ) => FIXED_KINDS.has( candidate.kind ) || candidate.kind === 'escort' )
			.sort( ( left, right ) => left.targetKey.localeCompare( right.targetKey ) ) ) {

			if ( ! target.availability.available || this.changedTargets.has( target.targetKey ) || this.escort?.targetKey === target.targetKey ) continue;
			const interaction = this.#mechanicInteraction( target, { timeMin, playerPlaces, feet, eye, look } );
			if ( ! interaction ) continue;
			this.liveInteractions.set( target.targetKey, interaction );
			candidates.push( {
				kind: 'quest', aim: Math.max( - 1, Math.min( 1, interaction.aim ) ),
				interaction: { targetKey: target.targetKey, prompt: interaction.prompt }
			} );

		}

		this.#dropInactiveActorMarks( new Set( [ ...targets, ...mechanics, ...places ].map( ( target ) => target.targetKey ) ) );
		return this.boundary.output( 'gameplay-candidates', candidates );

	}

	/** Runs the action advertised under the selected symbolic binding. */
	perform( request ) {

		this.boundary.input( 'gameplay-perform', request );
		const interaction = this.liveInteractions.get( request.targetKey );
		if ( ! interaction ) return null;
		const offered = interaction.target.presentation.actions.find( ( action ) => action.bindingAction === request.bindingAction );
		if ( ! offered ) return null;
		if ( interaction.mechanic ) return this.#performMechanic( interaction, offered, request.timeMin );

		const result = this.actions.perform( {
			targetKey: interaction.target.targetKey,
			action: offered.action,
			timeMin: request.timeMin,
			playerPlaces: interaction.playerPlaces,
			...( interaction.focus ? { focus: interaction.focus } : {} )
		} );
		if ( result.ok ) this.animations?.questInteraction( {
			targetKey: interaction.target.targetKey,
			action: offered.action,
			members: interaction.members ?? []
		} );

		for ( const change of result.worldChanges ) this.#applyWorldChange( change );
		return result;

	}

	/** Results completed by measured arrival or transit lifecycle events since the last frame. */
	drainMechanicResults() {

		return this.mechanicResults.splice( 0 );

	}

	/** Accepts only a fatal measured impact whose rendered body resolves to the active assassination identity. */
	fatalImpact( impact, npcId, timeMin ) {

		if ( ! impact?.fatal || ! npcId ) return null;
		const target = this.#mechanicTargets( timeMin ).find( ( candidate ) =>
			candidate.kind === 'assassinate' && candidate.actorIds[ 0 ] === npcId && candidate.availability.available );
		if ( ! target ) return null;
		const result = this.mechanics.complete( {
			questId: target.questId, stepId: target.stepId, timeMin,
			event: { kind: 'killed', npcId }
		} );
		if ( result.ok ) this.changedTargets.add( target.targetKey );
		return result;

	}

	/** Observes successful TransitGameplay board, ride and disembark results. */
	transitEvent( action, { timeMin, playerPlaces, position } ) {

		if ( ! action?.result?.ok ) return null;
		if ( action.action === 'board' ) {

			this.#beginTransitQuest( action.result, { timeMin, playerPlaces, position } );
			return null;

		}
		if ( ! this.transitQuest ) return null;
		const routeId = action.result.routeId;
		const tripId = action.result.tripId;
		if ( routeId !== this.transitQuest.routeId || tripId !== this.transitQuest.tripId ) return null;
		if ( ! this.#carryPassenger( position, routeId ) ) {

			const tracked = this.transitQuest;
			this.transitQuest = null;
			this.#releasePassenger( tracked.passengerNpcId, timeMin, position );
			return null;

		}
		if ( action.action !== 'disembark' && ! action.result.autoDisembarked ) return null;
		this.transitQuest.stage = 'arrival';
		return this.#completeTransit( { timeMin, playerPlaces, position } );

	}

	/** Reconstructs an active quest ride from the validated saved journey origin. */
	restoreTransit( request ) {

		this.boundary.input( 'transit-restore-request', request );
		if ( this.transitQuest ) return false;
		const target = this.#transitTarget( request.timeMin, [ request.origin ], false );
		if ( ! target || ! this.#restoredPassenger( target, request.routeId ) ) return false;
		const position = [ request.position.x, request.position.y, request.position.z ];
		this.transitQuest = {
			target, stage: 'aboard', tripId: request.tripId, routeId: request.routeId,
			passengerNpcId: target.actorIds[ 0 ] ?? null
		};
		if ( this.#carryPassenger( position, request.routeId ) ) return true;
		this.transitQuest = null;
		return false;

	}

	/** Restores an exact approach, aboard, or arrival stage saved with the quest runtime. */
	restoreTransitState( request ) {

		this.boundary.input( 'transit-state-restore-request', request );
		const saved = request.state;
		if ( this.transitQuest || ! saved ) return false;
		const target = this.#mechanicTargets( request.timeMin ).find( ( candidate ) =>
			candidate.questId === saved.questId
			&& candidate.stepId === saved.stepId
			&& candidate.kind === 'transportation'
			&& candidate.target.mode === 'public-transit'
			&& candidate.actorIds.length <= 1
			&& ( candidate.actorIds[ 0 ] ?? null ) === saved.passengerNpcId
			&& candidate.target.cargoItemIds.every( ( id ) =>
				this.session.inventoryView().some( ( item ) => item.id === id ) ) );
		if ( ! target ) return false;
		const aboard = saved.stage === 'aboard';
		if ( aboard !== Boolean( request.journey ) ) return false;
		if ( aboard && ( request.journey.tripId !== saved.tripId || request.journey.routeId !== saved.routeId ) ) return false;
		const position = [ request.position.x, request.position.y, request.position.z ];
		if ( aboard ) {

			if ( ! this.#restoredPassenger( target, saved.routeId ) ) return false;

		} else if ( ! this.#restoredGroundPassenger( target, position ) ) return false;
		this.transitQuest = {
			target, stage: saved.stage, tripId: saved.tripId, routeId: saved.routeId,
			passengerNpcId: saved.passengerNpcId
		};
		if ( ! aboard || this.#carryPassenger( position, saved.routeId ) ) return true;
		this.transitQuest = null;
		return false;

	}

	/** Serializable quest-side transit progress stored beside the timetable journey. */
	serializeTransit() {

		const tracked = this.transitQuest;
		return this.boundary.output( 'transit-state', tracked ? {
			questId: tracked.target.questId,
			stepId: tracked.target.stepId,
			stage: tracked.stage,
			tripId: tracked.tripId,
			routeId: tracked.routeId,
			passengerNpcId: tracked.passengerNpcId
		} : null );

	}

	#interaction( target, state ) {

		const { feet, eye, look, timeMin } = state;
		const playerPlaces = this.#placesAtTarget( target, state.playerPlaces, feet );
		if ( target.kind === 'pickup' ) {

			const mark = this.staticMarks.get( target.targetKey );
			if ( ! mark ) return null;
			const point = mark.userData.focusPoint;
			return this.#physical( target, point, feet, eye, look, playerPlaces, PHYSICAL_REACH.pickup );

		}

		if ( target.kind === 'steal' || target.kind === 'listen' ) {

			const anchor = target.place?.kind === 'parcel' ? this.anchors.get( target.place.id ) : null;
			const members = target.actorIds.map( ( npcId ) => this.crowd.questMember( npcId, timeMin, feet, target.place, anchor ) );
			if ( members.some( ( member ) => ! member ) ) {

				this.#markActors( target, [], eye );
				return null;

			}

			this.#markActors( target, members, eye );
			if ( target.kind === 'steal' ) {

				const point = members[ 0 ].position.clone().add( new THREE.Vector3( 0, CHEST, 0 ) );
				return this.#physical(
					target, point, feet, eye, look, playerPlaces, PHYSICAL_REACH.steal, members[ 0 ].position, members
				);

			}

			const points = members.map( ( member ) => member.position.clone().add( new THREE.Vector3( 0, CHEST, 0 ) ) );
			const point = points.reduce( ( total, each ) => total.add( each ), new THREE.Vector3() ).multiplyScalar( 1 / points.length );
			const distance = Math.max( ...members.map( ( member ) => feet.distanceTo( member.position ) ) );
			const clear = points.every( ( each ) => this.#clear( eye, each ) );
			const aim = aimAt( eye, look, point );
			if ( distance > PHYSICAL_REACH.listen || aim < MIN_AIM || ! clear || ! atPlace( playerPlaces, target.place ) ) return null;
			return interaction(
				target, playerPlaces, aim,
				{ visible: true, unobstructed: true, distanceMeters: distance }, members
			);

		}

		if ( target.kind === 'observe' ) {

			if ( ! atPlace( playerPlaces, target.place ) ) return null;
			return interaction( target, playerPlaces, MIN_AIM );

		}

		const mark = this.staticMarks.get( target.targetKey );
		if ( ! mark || ! atPlace( playerPlaces, target.place ) || feet.distanceTo( mark.position ) > AREA_REACH ) return null;
		// Standing on the mark, looking at it wins the crosshair from whoever is
		// walking past; looking away still leaves the prompt on offer.
		const point = mark.position.clone().setY( mark.position.y + CHEST );
		return interaction( target, playerPlaces, Math.max( MIN_AIM, aimAt( eye, look, point ) ) );

	}

	#presentMechanic( target ) {

		if ( FIXED_KINDS.has( target.kind ) ) {

			const fixed = this.missionItems?.mechanic( target.questId, target.stepId );
			const label = fixed?.binding.interactionId ?? target.kind;
			return {
				...target,
				fixed,
				presentation: {
					...target.presentation,
					actions: [ { action: label, label: verbLabel( label ), bindingAction: 'interact', progressesQuest: true } ]
				}
			};

		}
		if ( target.kind === 'escort' ) return {
			...target,
			presentation: {
				...target.presentation,
				actions: [ { action: 'escort', label: 'Escort', bindingAction: 'interact', progressesQuest: true } ]
			}
		};
		return target;

	}

	#mechanicInteraction( target, state ) {

		if ( FIXED_KINDS.has( target.kind ) ) {

			if ( ! target.fixed ) return null;
			const mark = this.staticMarks.get( target.targetKey );
			if ( ! mark ) return null;
			const value = this.#physical( target, mark.userData.focusPoint, state.feet, state.eye, state.look,
				this.#placesAtTarget( target, state.playerPlaces, state.feet ), PHYSICAL_REACH.pickup );
			return value ? { ...value, mechanic: true, playerPosition: state.feet.clone() } : null;

		}
		const anchor = target.place?.kind === 'parcel' ? this.anchors.get( target.place.id ) : null;
		const member = this.crowd.questMember( target.actorIds[ 0 ], state.timeMin, state.feet, target.place, anchor );
		if ( ! member ) return null;
		this.#markActors( target, [ member ], state.eye );
		const point = member.position.clone().add( new THREE.Vector3( 0, CHEST, 0 ) );
		const value = this.#physical(
			target, point, state.feet, state.eye, state.look,
			this.#placesAtTarget( target, state.playerPlaces, state.feet ), ESCORT_REACH, member.position, [ member ]
		);
		return value ? { ...value, mechanic: true, playerPosition: state.feet.clone() } : null;

	}

	#performMechanic( interaction, offered, timeMin ) {

		const target = interaction.target;
		if ( target.kind === 'escort' ) {

			try {

				const npcId = target.actorIds[ 0 ];
				const destination = continuityPlace( target.target.to );
				if ( target.target.mode === 'lead-player' && ! destination ) return null;
				// A companion already in this mode, as after a reload, is this escort's.
				const actor = this.#escorting( target )
					? this.continuity.actor( npcId )
					: target.target.mode === 'lead-player'
						? this.continuity.startLead( { npcId, timeMin, destination } )
						: this.continuity.startFollow( {
							npcId, timeMin, playerPosition: interaction.playerPosition.toArray()
						} );
				this.crowd.syncActor( actor, interaction.members[ 0 ].position );
				this.escort = { targetKey: target.targetKey, target };
				return null;

			} catch { return null; }

		}
		const request = mechanicRequest( target, timeMin );
		const rescue = target.kind === 'rescue' ? this.#acquireRescueFollow( target, interaction, request ) : null;
		if ( rescue && ! rescue.ok ) return rescue.result;
		let result;
		try {

			result = this.mechanics.complete( request );

		} catch ( error ) {

			if ( rescue?.started ) this.#releaseFollower( target.actorIds[ 0 ], timeMin, interaction.playerPosition );
			return this.mechanics.reject( request, messageOf( error ) );

		}
		if ( ! result.ok && rescue?.started ) this.#releaseFollower( target.actorIds[ 0 ], timeMin, interaction.playerPosition );
		if ( result.ok ) {

			this.changedTargets.add( target.targetKey );
			this.#removeMark( this.staticMarks, target.targetKey );
			this.animations?.questInteraction( {
				targetKey: target.targetKey, action: offered.action, members: interaction.members ?? []
			} );

		}
		return result;

	}

	#acquireRescueFollow( target, interaction, request ) {

		if ( ! this.continuity || target.actorIds.length !== 1 ) return {
			ok: false,
			result: this.mechanics.reject( request, 'The rescued NPC cannot enter follow control.' )
		};
		const npcId = target.actorIds[ 0 ];
		let started = false;
		try {

			const companion = this.continuity.companion;
			const existing = companion?.npcId === npcId && companion.mode === 'following';
			if ( companion && ! existing ) return {
				ok: false,
				result: this.mechanics.reject( request, `NPC ${companion.npcId} already has movement control.` )
			};
			started = ! existing;
			const actor = existing
				? this.continuity.actor( npcId )
				: this.continuity.startFollow( {
					npcId, timeMin: request.timeMin, playerPosition: interaction.playerPosition.toArray()
				} );
			if ( ! actor || ! this.crowd.syncActor( actor, interaction.playerPosition ) ) {

				if ( started ) this.#releaseFollower( npcId, request.timeMin, interaction.playerPosition );
				return {
					ok: false,
					result: this.mechanics.reject( request, `NPC ${npcId} is unavailable for follow control.` )
				};

			}
			return { ok: true, started };

		} catch ( error ) {

			if ( started ) this.#releaseFollower( npcId, request.timeMin, interaction.playerPosition );
			return { ok: false, result: this.mechanics.reject( request, messageOf( error ) ) };

		}

	}

	#materializePassiveCast( targets, { timeMin, playerPlaces, feet } ) {

		for ( const target of targets ) {

			if ( ! target.availability.available || this.changedTargets.has( target.targetKey ) || target.actorIds.length !== 1 ) continue;
			if ( target.kind !== 'assassinate' ) continue;
			this.#questMember( target.actorIds[ 0 ], timeMin, feet, target.place );

		}

	}

	/**
	 * Every person an open talk step sends the player to stands at that parcel
	 * while its hour is open, whatever the rota says, and wears a mark over
	 * their head: a side job's venue is otherwise an empty room with nobody in
	 * it, and a room with ten people in it is nobody in particular.
	 */
	#materializePlaceCast( places, { timeMin, feet, eye } ) {

		const wanted = new Set();
		const assigned = new Map();
		const distance = ( target ) => this.anchors.get( target.place?.id )?.distanceToSquared( feet ) ?? Infinity;

		// A shared character can have several open appointments. The one the
		// player is approaching owns its single body, instead of two targets
		// moving it back and forth in the same frame.
		for ( const target of [ ...places ].sort( ( left, right ) => distance( left ) - distance( right ) ) ) {

			if ( ! [ 'talk', 'listen' ].includes( target.kind ) || target.place?.kind !== 'parcel' ) continue;
			// A pinned meeting may differ from the cast's ordinary workplace.
			// Check its authored hour and quest state before posting, then let
			// the runtime verify the body's actual presence before advancing.
			if ( ! target.availability.available && ! this.session?.canPlaceCast?.( target.questId, target.stepId, timeMin ) ) {

				this.#markActors( target, [], eye );
				continue;

			}
			const members = [];
			for ( const npcId of target.actorIds ) {

				wanted.add( npcId );
				if ( assigned.has( npcId ) && assigned.get( npcId ) !== target.place.id ) continue;
				const member = target.kind === 'listen'
					? this.crowd.castMember( npcId, timeMin, feet, target.place.id, { meeting: true } )
					: this.crowd.castMember( npcId, timeMin, feet, target.place.id );
				if ( member ) {

					assigned.set( npcId, target.place.id );
					members.push( member );

				}

			}
			this.#markActors( target, members, eye );

		}

		this.#releaseHolds( wanted, timeMin, feet );

	}

	/** A cast body nobody is waiting on any more goes back to its own day. */
	#releaseHolds( wanted, timeMin, feet ) {

		for ( const npcId of this.continuity?.heldNpcIds ?? [] ) {

			if ( wanted.has( npcId ) ) continue;
			try {

				const actor = this.continuity.releaseHold( { npcId, timeMin } );
				this.crowd.syncActor( actor, feet );

			} catch ( error ) {

				console.warn( `quest cast ${npcId} could not return to its routine: ${messageOf( error )}` );

			}

		}

	}

	/**
	 * Completes the active escort once its companion and the player are at
	 * the destination: a leader must have arrived, a follower must be at hand.
	 * The quest step is completed while the NPC is still interrupted, then the
	 * NPC is released into its day. An escort whose companion gave up, or
	 * whose step closed, ends. So does one whose step became unavailable, as
	 * when its hour ends, and one whose completion is rejected: the player
	 * reads why once, and the step is offered again when it opens.
	 */
	#advanceEscort( targets, { timeMin, playerPlaces, feet } ) {

		if ( ! this.escort ) return;
		const npcId = this.escort.target.actorIds[ 0 ];
		const target = targets.find( ( candidate ) => candidate.targetKey === this.escort.targetKey );
		if ( ! target || ! this.#escorting( this.escort.target ) ) return this.#endEscort( npcId, timeMin, feet, null );
		const request = { questId: target.questId, stepId: target.stepId, timeMin, event: mechanicEvent( target ) };
		if ( ! target.availability.available ) {

			const message = QuestActions.unavailableMessage( target.availability.reason );
			return this.#endEscort( npcId, timeMin, feet, this.mechanics.reject( request, message ) );

		}
		const companion = this.continuity.companion;
		const arrived = target.target.mode === 'lead-player'
			? companion.phase === 'arrived'
			: feet.distanceTo( new THREE.Vector3().fromArray( companion.position ) ) <= ESCORT_REACH;
		if ( ! arrived || ! atPlace( playerPlaces, runtimePlace( target.target.to ) ) ) return;
		const result = this.mechanics.complete( request );
		if ( result.ok ) this.changedTargets.add( target.targetKey );
		this.#endEscort( npcId, timeMin, feet, result );

	}

	/** Ends the active escort, reports its result when there is one, and lets its NPC go. */
	#endEscort( npcId, timeMin, feet, result ) {

		this.escort = null;
		if ( result ) this.mechanicResults.push( result );
		this.#releaseFollower( npcId, timeMin, feet );

	}

	/** Whether the continuity companion is this escort target's NPC, in its mode. */
	#escorting( target ) {

		const companion = this.continuity?.companion;
		return companion?.npcId === target.actorIds[ 0 ]
			&& companion.mode === ( target.target.mode === 'lead-player' ? 'leading' : 'following' );

	}

	/** The active escort for the save, or null. */
	serializeEscort() {

		const escort = this.escort;
		return this.boundary.output( 'escort-state', escort ? {
			questId: escort.target.questId,
			stepId: escort.target.stepId,
			npcId: escort.target.actorIds[ 0 ],
			mode: escort.target.target.mode
		} : null );

	}

	/**
	 * Takes back a saved escort when its step is still open and the restored
	 * continuity companion is the same NPC in the same mode. A companion left
	 * over from an escort that cannot be taken back is released.
	 */
	restoreEscort( request ) {

		this.boundary.input( 'escort-restore-request', request );
		const saved = request.state;
		if ( this.escort || ! saved ) return false;
		const target = this.#mechanicTargets( request.timeMin ).find( ( candidate ) =>
			candidate.kind === 'escort'
			&& candidate.questId === saved.questId
			&& candidate.stepId === saved.stepId
			&& candidate.actorIds[ 0 ] === saved.npcId
			&& candidate.target.mode === saved.mode );
		if ( target && this.#escorting( target ) ) {

			this.escort = { targetKey: target.targetKey, target };
			return true;

		}
		if ( this.continuity?.companion?.npcId === saved.npcId ) this.#releaseFollower( saved.npcId, request.timeMin, null );
		return false;

	}

	#beginTransitQuest( result, state ) {

		if ( ! this.transitQuest ) {

			const target = this.#transitTarget( state.timeMin, state.playerPlaces, true );
			if ( ! target || ! this.#prepareTransit( target, state.timeMin, state.position ) ) return false;

		}
		const tracked = this.transitQuest;
		if ( tracked.stage === 'aboard' || ! this.#activePassenger( tracked, state.position ) ) return false;
		const previous = { stage: tracked.stage, tripId: tracked.tripId, routeId: tracked.routeId };
		Object.assign( tracked, {
			stage: 'aboard', tripId: result.service.tripId, routeId: result.service.routeId
		} );
		if ( ! this.#carryPassenger( state.position, result.service.routeId ) ) {

			Object.assign( tracked, previous );
			return false;

		}
		return true;

	}

	#prepareTransit( target, timeMin, position ) {

		const passengerNpcId = target.actorIds[ 0 ] ?? null;
		const controlled = this.#activePassenger( { passengerNpcId }, position );
		if ( passengerNpcId && ! controlled && ! this.#ensurePassenger( target, timeMin, position ) ) return false;
		this.transitQuest = {
			target, stage: 'approach', tripId: null, routeId: null,
			passengerNpcId
		};
		return true;

	}

	#advanceTransit( targets, { timeMin, playerPlaces, feet } ) {

		if ( ! this.transitQuest ) {

			const target = this.#transitTarget( timeMin, playerPlaces, true );
			if ( target ) this.#prepareTransit( target, timeMin, feet.toArray() );
			return;

		}
		const target = targets.find( ( candidate ) => candidate.targetKey === this.transitQuest.target.targetKey );
		if ( ! target ) {

			this.#releasePassenger( this.transitQuest.passengerNpcId, timeMin, feet.toArray() );
			this.transitQuest = null;
			return;

		}
		this.transitQuest.target = target;
		if ( this.transitQuest.stage !== 'arrival' ) return;
		const result = this.#completeTransit( { timeMin, playerPlaces, position: feet.toArray() } );
		if ( result ) this.mechanicResults.push( result );

	}

	#completeTransit( state ) {

		const tracked = this.transitQuest;
		if ( ! tracked || tracked.stage !== 'arrival' ) return null;
		if ( ! atPlace( state.playerPlaces, runtimePlace( tracked.target.target.to ) ) ) return null;
		if ( ! this.#activePassenger( tracked, state.position ) ) return null;
		const result = this.mechanics.complete( {
			questId: tracked.target.questId, stepId: tracked.target.stepId, timeMin: state.timeMin,
			event: mechanicEvent( tracked.target )
		} );
		if ( ! result.ok ) return result;
		this.changedTargets.add( tracked.target.targetKey );
		this.#releasePassenger( tracked.passengerNpcId, state.timeMin, state.position );
		this.transitQuest = null;
		return result;

	}

	#activePassenger( tracked, position ) {

		const npcId = tracked.passengerNpcId;
		if ( ! npcId ) return true;
		if ( ! this.#following( npcId ) ) return false;
		const actor = this.continuity.actor( npcId );
		const player = new THREE.Vector3().fromArray( position );
		if ( player.distanceTo( new THREE.Vector3().fromArray( actor.position ) ) > ESCORT_REACH ) return false;
		return Boolean( this.crowd.syncActor( actor, player ) );

	}

	#transitTarget( timeMin, playerPlaces, requireAvailable ) {

		return this.#mechanicTargets( timeMin ).find( ( candidate ) =>
			candidate.kind === 'transportation'
			&& ( ! requireAvailable || candidate.availability.available )
			&& candidate.target.mode === 'public-transit'
			&& atPlace( playerPlaces, runtimePlace( candidate.target.from ) )
			&& candidate.actorIds.length <= 1
			&& candidate.target.cargoItemIds.every( ( id ) =>
				this.session.inventoryView().some( ( item ) => item.id === id ) ) );

	}

	#mechanicTargets( timeMin ) {

		return this.actions.mechanics?.( { timeMin } ) ?? [];

	}

	#restoredPassenger( target, routeId ) {

		if ( target.actorIds.length === 0 ) return true;
		const npcId = target.actorIds[ 0 ];
		if ( ! this.#following( npcId ) ) return false;
		const place = this.continuity.actor( npcId ).place;
		return place.kind === 'route' && place.id === routeId;

	}

	#restoredGroundPassenger( target, position ) {

		if ( target.actorIds.length === 0 ) return true;
		const npcId = target.actorIds[ 0 ];
		if ( ! this.#following( npcId ) ) return false;
		return Boolean( this.crowd.syncActor( this.continuity.actor( npcId ), new THREE.Vector3().fromArray( position ) ) );

	}

	#ensurePassenger( target, timeMin, position ) {

		if ( ! this.continuity ) return false;
		const npcId = target.actorIds[ 0 ];
		const player = new THREE.Vector3().fromArray( position );
		const member = this.#questMember( npcId, timeMin, player, runtimePlace( target.target.from ) );
		if ( ! member || member.position.distanceTo( player ) > ESCORT_REACH ) return false;
		if ( this.#following( npcId ) ) return true;
		if ( this.continuity.companion ) return false;
		try {

			const actor = this.continuity.startFollow( { npcId, timeMin, playerPosition: [ ...position ] } );
			if ( ! this.crowd.syncActor( actor, player ) ) {

				this.#releaseFollower( npcId, timeMin, player );
				return false;

			}
			return true;

		} catch {

			this.#releaseFollower( npcId, timeMin, player );
			return false;

		}

	}

	#carryPassenger( position, routeId ) {

		const npcId = this.transitQuest?.passengerNpcId;
		if ( ! npcId ) return true;
		try {

			const actor = this.continuity.carryFollower( { npcId, position: [ ...position ], routeId } );
			return Boolean( this.crowd.syncActor(
				actor, vector3( { x: position[ 0 ], y: position[ 1 ], z: position[ 2 ] } )
			) );

		} catch { return false; }

	}

	#releasePassenger( npcId, timeMin, position ) {

		this.#releaseFollower( npcId, timeMin, new THREE.Vector3().fromArray( position ) );

	}

	#releaseFollower( npcId, timeMin, player ) {

		if ( ! npcId || this.continuity?.companion?.npcId !== npcId ) return false;
		try {

			const actor = this.continuity.stopFollow( { timeMin } );
			if ( player ) this.crowd.syncActor( actor, player );
			return true;

		} catch { return false; }

	}

	/** Whether this NPC is the continuity companion, following the player. */
	#following( npcId ) {

		const companion = this.continuity?.companion;
		return companion?.npcId === npcId && companion.mode === 'following';

	}

	#questMember( npcId, timeMin, player, place ) {

		const anchor = place?.kind === 'parcel' ? this.anchors.get( place.id ) : null;
		return this.crowd.questMember( npcId, timeMin, player, place, anchor );

	}

	#controlFailure( request, error, message ) {

		return this.boundary.output( 'npc-control-result', {
			ok: false, kind: request.kind, npcId: request.npcId, error, message
		} );

	}

	#placesAtTarget( target, playerPlaces, feet ) {

		if ( atPlace( playerPlaces, target.place ) || target.place?.kind !== 'parcel' ) return playerPlaces;
		const anchor = this.anchors.get( target.place.id );
		return anchor && feet.distanceTo( anchor ) <= AREA_REACH
			? [ ...playerPlaces, { ...target.place } ]
			: playerPlaces;

	}

	#physical( target, point, feet, eye, look, playerPlaces, reach, distancePoint = point, members = [] ) {

		const distance = feet.distanceTo( distancePoint );
		const aim = aimAt( eye, look, point );
		if ( distance > reach || aim < MIN_AIM || ! atPlace( playerPlaces, target.place ) ) return null;
		if ( ! this.#clear( eye, point, target.targetKey ) ) return null;

		return interaction( target, playerPlaces, aim, { visible: true, unobstructed: true, distanceMeters: distance }, members );

	}

	#clear( from, to, targetKey = null ) {

		if ( ! this.physics?.world?.castRay || ! this.physics.rapier?.Ray ) return true;
		const delta = to.clone().sub( from );
		const distance = delta.length();
		if ( distance <= 0.25 ) return true;
		const ray = new this.physics.rapier.Ray( from, delta.multiplyScalar( 1 / distance ) );
		const targetHandles = new Set(
			( this.targetColliders.get( targetKey ) ?? [] ).map( ( handle ) => handle.collider.handle )
		);
		// ImpactWorld's pedestrian/vehicle sensors measure contacts; they are
		// not solid occluders. In particular, a speaker's own capsule reaches
		// farther than the endpoint margin and must not block their chest.
		return ! this.physics.world.castRay(
			ray, distance - 0.25, true, this.physics.rapier.QueryFilterFlags?.EXCLUDE_SENSORS, undefined, this.playerCollider, undefined,
			( collider ) => ! targetHandles.has( collider.handle )
		);

	}

	#sync( targets ) {

		const active = new Set();

		for ( const target of targets ) {

			if ( ! MARKED_KINDS.has( target.kind ) || target.place?.kind !== 'parcel' ) continue;
			active.add( target.targetKey );
			if ( this.staticMarks.has( target.targetKey ) || this.changedTargets.has( target.targetKey ) ) continue;
			const anchor = this.anchors.get( target.place.id );
			if ( ! anchor ) continue;
			const fixed = FIXED_KINDS.has( target.kind ) ? target.fixed : null;
			const assembly = target.kind === 'pickup'
				? this.missionItems?.get( target.questId, target.item?.id )
				: fixed?.assembly ?? null;
			if ( target.kind === 'pickup' && ( ! assembly?.portable || ! anchorFor( assembly, 'take' ) ) ) continue;
			if ( FIXED_KINDS.has( target.kind ) && ! fixed ) continue;
			const mark = target.kind === 'pickup' || fixed
				? missionMark( target, anchor, assembly, this.materialFactory, fixed?.binding.interactionId ?? 'take' )
				: areaMark( target, anchor );
			this.staticMarks.set( target.targetKey, mark );
			this.group.add( mark );
			if ( assembly ) this.#collide( target.targetKey, assembly, anchor );

		}

		for ( const [ key, mark ] of this.staticMarks ) {

			// Pickup props leave only through an accepted result.worldChanges entry.
			if ( mark.userData.kind === 'pickup' || active.has( key ) ) continue;
			this.#removeMark( this.staticMarks, key );

		}

	}

	/**
	 * One mark over the head of every person an open step is about, turned to
	 * the eye, grown with the distance so it still reads across a room, and
	 * drawn over the walls between.
	 */
	#markActors( target, members, eye ) {

		let marks = this.actorMarks.get( target.targetKey );
		if ( marks?.length !== members.length ) {

			this.#removeMark( this.actorMarks, target.targetKey );
			if ( members.length === 0 ) return;
			marks = members.map( () => actorMark() );
			this.actorMarks.set( target.targetKey, marks );
			this.group.add( ...marks );

		}

		marks?.forEach( ( mark, index ) => {

			mark.position.copy( members[ index ].position ).add( new THREE.Vector3( 0, HEAD, 0 ) );
			mark.lookAt( eye );
			const reach = mark.position.distanceTo( eye );
			mark.scale.setScalar( Math.min( MARK_MAX_SCALE, Math.max( 1, reach / MARK_REFERENCE ) ) );

		} );

	}

	#dropInactiveActorMarks( active ) {

		for ( const key of this.actorMarks.keys() ) if ( ! active.has( key ) ) this.#removeMark( this.actorMarks, key );

	}

	#applyWorldChange( change ) {

		this.changedTargets.add( change.targetKey );
		this.#removeMark( this.staticMarks, change.targetKey );
		this.#removeMark( this.actorMarks, change.targetKey );

	}

	#removeMark( collection, key ) {

		const present = collection.get( key );
		if ( ! present ) return;
		const marks = Array.isArray( present ) ? present : [ present ];
		for ( const mark of marks ) {

			this.group.remove( mark );
			mark.traverse( ( node ) => {

				node.geometry?.dispose?.();
				if ( ! node.material?.name ) node.material?.dispose?.();

			} );

		}
		collection.delete( key );
		for ( const handle of this.targetColliders.get( key ) ?? [] ) this.physics?.remove?.( handle );
		this.targetColliders.delete( key );

	}

	#collide( targetKey, assembly, anchor ) {

		if ( ! this.physics?.addTrimesh ) return;
		const handles = [];
		try {

			for ( const primitive of assembly.geometry.primitives ) {

				const geometry = primitiveGeometry( primitive );
				geometry.translate( anchor.x, anchor.y, anchor.z );
				try {

					handles.push( this.physics.addTrimesh( geometry ) );

				} finally {

					geometry.dispose();

				}

			}
			this.targetColliders.set( targetKey, handles );

		} catch ( error ) {

			for ( const handle of handles ) this.physics.remove?.( handle );
			throw error;

		}

	}

}

function interaction( target, playerPlaces, aim, focus, members = [] ) {

	return {
		target, playerPlaces: playerPlaces.map( ( place ) => ( { ...place } ) ), aim,
		prompt: promptFor( target ), members: [ ...members ], ...( focus ? { focus } : {})
	};

}

function promptFor( target ) {

	return target.presentation.actions.map( ( action ) => {

		const key = action.bindingAction === 'secondary-interact' ? 'R' : 'E';
		return `${key}  ${action.label.toLowerCase()} ${target.presentation.name}`;

	} ).join( '   ' );

}

function atPlace( places, target ) {

	return Boolean( target ) && places.some( ( place ) => place.kind === target.kind && place.id === target.id );

}

function aimAt( eye, look, point ) {

	return point.clone().sub( eye ).normalize().dot( look );

}

function vector3( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}

function array3( value ) {

	return [ value.x, value.y, value.z ];

}

function controlError( error ) {

	if ( error?.code === 'E_NPC_PATH' ) return 'unreachable';
	if ( error?.code === 'E_NPC_CONFLICT' ) return 'conflict';
	return 'unavailable';

}

function messageOf( error ) {

	return error instanceof Error ? error.message : String( error );

}

function mechanicRequest( target, timeMin ) {

	return {
		questId: target.questId,
		stepId: target.stepId,
		timeMin,
		event: mechanicEvent( target )
	};

}

/** Validated static parcel placement data crossing from the assembled city. */
export function questGameplayWorld( atlas, doors, boundary = new QuestActionBoundary() ) {

	const byDoor = new Map( doors.map( ( door ) => [ door.parcelId, door ] ) );
	const world = { parcels: atlas.parcels.map( ( parcel ) => {

		const door = byDoor.get( parcel.id );
		if ( door ) return { id: parcel.id, anchor: door.inside.toArray() };
		const [ x, z ] = parcel.access.point;
		return { id: parcel.id, anchor: [ x, 0.12, z ] };

	} ) };
	return boundary.output( 'gameplay-world', world );

}

function missionMark( target, anchor, assembly, materialFactory, interactionId ) {

	const group = new THREE.Group();
	const materials = new Map( assembly.materials.map( ( assignment ) => {

		const material = materialFactory.build( assignment.key, assignment.variantId );
		if ( ! material || material.name?.startsWith( 'unresolved:' ) ) {

			throw new Error( `mission item material ${assignment.key}#${assignment.variantId} is unavailable` );

		}
		return [ assignment.slot, material ];

	} ) );
	for ( const primitive of assembly.geometry.primitives ) {

		const geometry = primitiveGeometry( primitive );
		const mesh = new THREE.Mesh( geometry, materials.get( primitive.materialSlot ) );
		mesh.name = `${assembly.assetId}:${primitive.primitiveId}`;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		const outline = new THREE.LineSegments(
			new THREE.EdgesGeometry( geometry ),
			new THREE.LineBasicMaterial( { color: 0x69f4ff } )
		);
		outline.position.copy( mesh.position );
		group.add( mesh, outline );

	}
	const icon = new THREE.Mesh(
		new THREE.OctahedronGeometry( 0.16 ),
		new THREE.MeshBasicMaterial( { color: 0xff5fa8 } )
	);
	icon.position.y = assembly.dimensions.height + 0.45;
	group.add( icon );
	group.position.copy( anchor );
	group.name = `quest-target:${target.targetKey}`;
	const focusAnchor = anchorFor( assembly, interactionId );
	group.userData = {
		targetKey: target.targetKey,
		kind: target.kind,
		assetId: assembly.assetId,
		focusPoint: anchor.clone().add( vector( focusAnchor.position ) )
	};
	return group;

}

function primitiveGeometry( primitive ) {

	const geometry = new THREE.BoxGeometry( primitive.size.width, primitive.size.height, primitive.size.depth );
	geometry.rotateX( primitive.rotationRadians.x );
	geometry.rotateY( primitive.rotationRadians.y );
	geometry.rotateZ( primitive.rotationRadians.z );
	geometry.translate( primitive.position.x, primitive.position.y, primitive.position.z );
	return geometry;

}

function anchorFor( assembly, interactionId ) {

	return assembly.interactionAnchors.find( ( anchor ) => anchor.interaction === interactionId ) ?? null;

}

function vector( value ) {

	return new THREE.Vector3( value.x, value.y, value.z );

}

function areaMark( target, anchor ) {

	const mark = new THREE.Mesh(
		new THREE.RingGeometry( 0.45, 0.65, 24 ),
		new THREE.MeshBasicMaterial( { color: 0x69f4ff, side: THREE.DoubleSide, transparent: true, opacity: 0.8 } )
	);
	mark.rotation.x = - Math.PI / 2;
	mark.position.copy( anchor ).setY( anchor.y + 0.03 );
	mark.name = `quest-target:${target.targetKey}`;
	mark.userData = { targetKey: target.targetKey, kind: target.kind };
	return mark;

}

/** The quest marker: a pennant that points down at the person under it. */
function actorMark() {

	const shape = new THREE.Shape();
	shape.moveTo( 0, - 0.26 );
	shape.lineTo( 0.19, 0.06 );
	shape.lineTo( 0.07, 0.06 );
	shape.lineTo( 0.07, 0.28 );
	shape.lineTo( - 0.07, 0.28 );
	shape.lineTo( - 0.07, 0.06 );
	shape.lineTo( - 0.19, 0.06 );
	shape.closePath();
	const mark = new THREE.Mesh( new THREE.ShapeGeometry( shape ), new THREE.MeshBasicMaterial( {
		color: 0xff5fa8, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
		depthTest: false, depthWrite: false
	} ) );
	mark.renderOrder = MARK_RENDER_ORDER;
	mark.name = 'quest-actor-mark';
	return mark;

}

function runtimePlace( place ) {

	if ( place.parcelId ) return { kind: 'parcel', id: place.parcelId };
	if ( place.districtId ) return { kind: 'district', id: place.districtId };
	if ( place.stationId ) return { kind: 'station', id: place.stationId };
	return { kind: 'stop', id: place.stopId };

}

/** The continuity place of an authored escort place: stations are walked to as their `stop`, districts have no point. */
function continuityPlace( place ) {

	if ( place.parcelId ) return { kind: 'parcel', id: place.parcelId };
	if ( place.stationId ) return { kind: 'stop', id: place.stationId };
	if ( place.stopId ) return { kind: 'stop', id: place.stopId };
	return null;

}

function mechanicEvent( projected ) {

	const target = projected.target;
	if ( projected.kind === 'rescue' ) return {
		kind: 'released', npcId: projected.actorIds[ 0 ], releaseTargetId: target.releaseTargetId,
		place: target.place
	};
	if ( projected.kind === 'escort' ) return {
		kind: 'escorted', npcId: projected.actorIds[ 0 ], routeId: target.routeId, mode: target.mode,
		from: target.from, to: target.to
	};
	if ( projected.kind === 'access' ) return {
		kind: 'accessed', accessPointId: target.accessPointId, credentialItemId: target.credentialItemId,
		place: target.place
	};
	if ( projected.kind === 'hacking' ) return { kind: 'hacked', targetId: target.targetId, place: target.place };
	if ( projected.kind === 'sabotage' ) return { kind: 'sabotaged', targetId: target.targetId, place: target.place };
	if ( projected.kind === 'transportation' ) return {
		kind: 'transported', journeyId: target.journeyId, mode: target.mode, from: target.from, to: target.to,
		passengerNpcIds: [ ...projected.actorIds ], cargoItemIds: [ ...target.cargoItemIds ]
	};
	throw new Error( `unsupported measured mechanic ${projected.kind}` );

}

function verbLabel( interactionId ) {

	return { open: 'Open', use: 'Use', access: 'Access', hack: 'Hack', sabotage: 'Sabotage' }[ interactionId ];

}
