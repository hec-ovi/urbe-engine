import * as THREE from 'three/webgpu';
import { QuestActions } from './QuestActions.js';
import { QuestActionBoundary } from './QuestActionBoundary.js';
import { QuestMechanics } from './QuestMechanics.js';

const PHYSICAL_REACH = { pickup: 2.5, steal: 2, listen: 8 };
const AREA_REACH = 3.2;
const MIN_AIM = 0.76;
const CHEST = 1.3;
const FIXED_KINDS = new Set( [ 'rescue', 'access', 'hacking', 'sabotage' ] );
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

				const follow = this.continuity.serialize().follow;
				if ( follow?.npcId !== request.npcId || follow.mode !== 'following' ) {

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

	objective( timeMin ) {

		return this.actions.objective( { timeMin } );

	}

	/** Candidates consumed by the shared door, lift, NPC and quest Interactor. */
	candidates( frame ) {

		this.boundary.input( 'gameplay-frame', frame );
		const { timeMin, playerPlaces } = frame;
		const feet = vector3( frame.feet );
		const eye = vector3( frame.eye );
		const look = vector3( frame.look );
		const targets = this.actions.targets( { timeMin } );
		const mechanics = ( this.actions.mechanics?.( { timeMin } ) ?? [] ).map( ( target ) => this.#presentMechanic( target ) );
		this.#advanceEscort( mechanics, { timeMin, playerPlaces, feet } );
		this.#materializePassiveCast( mechanics, { timeMin, playerPlaces, feet } );
		this.#sync( [ ...targets, ...mechanics ] );
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

		this.#dropInactiveActorMarks( new Set( [ ...targets, ...mechanics ].map( ( target ) => target.targetKey ) ) );
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
		const target = this.actions.mechanics( { timeMin } ).find( ( candidate ) =>
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
		if ( action.action === 'board' ) return this.#beginTransitQuest( action.result, { timeMin, playerPlaces, position } );
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
		const tracked = this.transitQuest;
		this.transitQuest = null;
		this.#releasePassenger( tracked.passengerNpcId, timeMin, position );
		if ( ! atPlace( playerPlaces, runtimePlace( tracked.target.target.to ) ) ) return null;
		const result = this.mechanics.complete( {
			questId: tracked.target.questId, stepId: tracked.target.stepId, timeMin,
			event: mechanicEvent( tracked.target )
		} );
		if ( result.ok ) this.changedTargets.add( tracked.target.targetKey );
		return result;

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
		return interaction( target, playerPlaces, MIN_AIM );

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
				const state = this.continuity.serialize();
				const existing = target.target.mode === 'follow-player'
					&& state.follow?.npcId === npcId && state.follow.mode === 'following';
				const actor = existing
					? state.actors.find( ( candidate ) => candidate.npcId === npcId )
					: target.target.mode === 'lead-player'
						? this.continuity.startLead( { npcId, timeMin, destination: runtimePlace( target.target.to ) } )
						: this.continuity.startFollow( {
							npcId, timeMin, playerPosition: interaction.playerPosition.toArray()
						} );
				if ( ! actor ) return null;
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

			const state = this.continuity.serialize();
			const existing = state.follow?.npcId === npcId && state.follow.mode === 'following';
			if ( state.follow && ! existing ) return {
				ok: false,
				result: this.mechanics.reject( request, `NPC ${state.follow.npcId} already has movement control.` )
			};
			started = ! existing;
			const actor = existing
				? state.actors.find( ( candidate ) => candidate.npcId === npcId )
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
			const assassination = target.kind === 'assassinate';
			const transitPassenger = target.kind === 'transportation'
				&& target.target.mode === 'public-transit'
				&& atPlace( playerPlaces, runtimePlace( target.target.from ) );
			if ( ! assassination && ! transitPassenger ) continue;
			this.#questMember( target.actorIds[ 0 ], timeMin, feet, target.place );

		}

	}

	#advanceEscort( targets, { timeMin, playerPlaces, feet } ) {

		if ( ! this.escort ) return;
		const target = targets.find( ( candidate ) => candidate.targetKey === this.escort.targetKey );
		if ( ! target ) { this.escort = null; return; }
		const state = this.continuity?.serialize();
		const follow = state?.follow;
		const actor = state?.actors?.find( ( candidate ) => candidate.npcId === target.actorIds[ 0 ] );
		const nearby = actor?.position && feet.distanceTo( new THREE.Vector3().fromArray( actor.position ) ) <= ESCORT_REACH;
		const arrivedActor = target.target.mode === 'lead-player'
			? follow?.mode === 'leading' && actor?.animation === 'idle'
			: follow?.mode === 'following' && nearby;
		if ( ! arrivedActor || ! atPlace( playerPlaces, runtimePlace( target.target.to ) ) ) return;
		try { this.continuity.stopFollow( { timeMin } ); } catch { return; }
		this.escort = null;
		const result = this.mechanics.complete( {
			questId: target.questId, stepId: target.stepId, timeMin, event: mechanicEvent( target )
		} );
		if ( result.ok ) {

			this.changedTargets.add( target.targetKey );
			this.mechanicResults.push( result );

		}

	}

	#beginTransitQuest( result, state ) {

		const target = this.actions.mechanics( { timeMin: state.timeMin } ).find( ( candidate ) =>
			candidate.kind === 'transportation' && candidate.availability.available
			&& candidate.target.mode === 'public-transit'
			&& atPlace( state.playerPlaces, runtimePlace( candidate.target.from ) )
			&& candidate.actorIds.length <= 1
			&& candidate.target.cargoItemIds.every( ( id ) => this.session.inventoryView().some( ( item ) => item.id === id ) ) );
		if ( ! target ) return null;
		if ( target.actorIds.length === 1 && ! this.#ensurePassenger( target, state.timeMin, state.position ) ) return null;
		this.transitQuest = {
			target, tripId: result.service.tripId, routeId: result.service.routeId,
			passengerNpcId: target.actorIds[ 0 ] ?? null
		};
		if ( ! this.#carryPassenger( state.position, result.service.routeId ) ) {

			const tracked = this.transitQuest;
			this.transitQuest = null;
			this.#releasePassenger( tracked.passengerNpcId, state.timeMin, state.position );

		}
		return null;

	}

	#ensurePassenger( target, timeMin, position ) {

		if ( ! this.continuity ) return false;
		const npcId = target.actorIds[ 0 ];
		const player = new THREE.Vector3().fromArray( position );
		const member = this.#questMember( npcId, timeMin, player, runtimePlace( target.target.from ) );
		if ( ! member || member.position.distanceTo( player ) > ESCORT_REACH ) return false;
		const state = this.continuity.serialize();
		const follow = state.follow;
		if ( follow?.npcId === npcId && follow.mode === 'following' ) return true;
		if ( follow ) return false;
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
			this.crowd.syncActor( actor, vector3( { x: position[ 0 ], y: position[ 1 ], z: position[ 2 ] } ) );
			return true;

		} catch { return false; }

	}

	#releasePassenger( npcId, timeMin, position ) {

		this.#releaseFollower( npcId, timeMin, new THREE.Vector3().fromArray( position ) );

	}

	#releaseFollower( npcId, timeMin, player ) {

		if ( ! npcId || ! this.continuity ) return false;
		try {

			const follow = this.continuity.serialize().follow;
			if ( follow?.npcId !== npcId || ! [ 'following', 'leading' ].includes( follow.mode ) ) return false;
			const actor = this.continuity.stopFollow( { timeMin } );
			this.crowd.syncActor( actor, player );
			return true;

		} catch { return false; }

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
		return ! this.physics.world.castRay(
			ray, distance - 0.25, true, undefined, undefined, this.playerCollider, undefined,
			( collider ) => ! targetHandles.has( collider.handle )
		);

	}

	#sync( targets ) {

		const active = new Set();

		for ( const target of targets ) {

			if ( ! [ 'pickup', 'work', 'deliver', ...FIXED_KINDS ].includes( target.kind ) || target.place?.kind !== 'parcel' ) continue;
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

	#markActors( target, members, eye ) {

		let marks = this.actorMarks.get( target.targetKey );
		if ( marks?.length !== members.length ) {

			this.#removeMark( this.actorMarks, target.targetKey );
			marks = members.map( () => actorMark() );
			this.actorMarks.set( target.targetKey, marks );
			this.group.add( ...marks );

		}

		marks?.forEach( ( mark, index ) => {

			mark.position.copy( members[ index ].position ).add( new THREE.Vector3( 0, CHEST, 0 ) );
			mark.lookAt( eye );

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

function actorMark() {

	return new THREE.Mesh(
		new THREE.TorusGeometry( 0.42, 0.035, 6, 24 ),
		new THREE.MeshBasicMaterial( { color: 0xff5fa8, transparent: true, opacity: 0.9 } )
	);

}

function runtimePlace( place ) {

	if ( place.parcelId ) return { kind: 'parcel', id: place.parcelId };
	if ( place.districtId ) return { kind: 'district', id: place.districtId };
	if ( place.stationId ) return { kind: 'station', id: place.stationId };
	return { kind: 'stop', id: place.stopId };

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
