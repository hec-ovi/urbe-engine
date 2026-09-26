import { NpcContinuityBoundary } from './NpcContinuityBoundary.js';
import { NpcContinuityError } from './NpcContinuityError.js';

const WALK_SPEED = 1.4;
const RUN_SPEED = 2.4;
/** A leader's slowest walk while the player lags behind it. */
const SLOW_SPEED = 0.8;
const RUN_DISTANCE = 8;
const STOPPING_DISTANCE = 1.8;
const ARRIVAL_DISTANCE = 0.08;
/** Distance below which a remaining stretch counts as already walked. */
const EPSILON = 1e-6;
/** A leader slows past this lag, stops and waits past the next, and walks on inside the last. */
const LEAD_SLOW_FROM = 4;
const LEAD_WAIT_BEYOND = 10;
const LEAD_RESUME_WITHIN = 6;
/** How far beside the leader's path the player may be and still count as ahead on it. */
const LEAD_PATH_WIDTH = 6;
/** Give-up used by a lead request that names no pace. */
const LEAD_PACE = { giveUpBeyond: 60, giveUpAfterMin: 3 };
/** A cached route is planned again once its moving target has gone this far from its end. */
const FOLLOW_REPLAN = 1;
const RETURN_REPLAN = 2;

/**
 * Persistent materialization and control of actual simulation NPC ids: one
 * companion following or leading the player, walks home, conversation, crouch
 * and quest holds. It owns no population or schedule data: every scheduled
 * state is projected from the simulation, and every moving point is sampled
 * from the Connections walk graph supplied through WalkRoutes.
 */
export class NpcContinuity {

	constructor( { simulation, routes, places = [], boundary = new NpcContinuityBoundary() } ) {

		this.simulation = simulation;
		this.routes = routes;
		this.boundary = boundary;
		const networks = this.boundary.input( 'movement-network', routes.networks );
		this.transitRoutes = new Map( ( networks.transit?.routes ?? [] ).map( ( route ) => [ route.id, route ] ) );
		this.places = new Map( this.boundary.input( 'places', places ).map( ( place ) => [ placeKey( place ), place ] ) );
		this.actors = new Map();
		/** The one companion following or leading the player. */
		this.follow = null;
		/** Identities walking from where control let them go back into their day, by npcId. */
		this.returns = new Map();
		this.conversation = null;
		this.pose = null;
		/** Identities a quest is keeping where they stand, by npcId. */
		this.holds = new Map();
		/** Rendered staff/chair placements, valid only for one schedule occurrence. */
		this.posts = new Map();
		/** Companion phase changes since the latest updateFollow began. */
		this.events = [];

	}

	/** The companion's identity, mode, phase and position, without a validated save. */
	get companion() {

		if ( ! this.follow ) return null;
		const { npcId, mode, phase } = this.follow;
		return { npcId, mode, phase, position: [ ...this.actors.get( npcId ).position ] };

	}

	/** Every identity a quest is holding in place right now. */
	get heldNpcIds() {

		return [ ...this.holds.keys() ];

	}

	/** The retained state of one materialized identity, or null. */
	actor( npcId ) {

		return this.#actorMaybeOut( this.actors.get( npcId ) ?? null );

	}

	/** Returns and clears the companion phase changes of the latest updateFollow and later calls. */
	drainEvents() {

		return this.boundary.output( 'control-events', this.events.splice( 0 ) );

	}

	/** Materializes one exact identity at its current scheduled point. */
	appear( request ) {

		this.boundary.input( 'appearance-request', request );
		const { npcId, timeMin } = request;
		if ( this.#controls( npcId ) || this.returns.has( npcId ) ) {

			const actor = this.actors.get( npcId );
			actor.visible = true;
			return this.#actorOut( actor );

		}
		const actor = this.#scheduledActor( npcId, timeMin );
		actor.visible = true;
		this.actors.set( npcId, actor );
		return this.#actorOut( actor );

	}

	unload( request ) {

		this.boundary.input( 'unload-request', request );
		const { npcId } = request;
		if ( this.#controls( npcId ) ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${npcId} is under active control` );

		}
		this.returns.delete( npcId );
		const actor = this.actors.get( npcId );
		if ( actor ) actor.visible = false;
		return this.#actorMaybeOut( actor ?? null );

	}

	/**
	 * Reprojects every visible materialization and virtualizes distant
	 * schedule-controlled bodies. A walk home out of sight is finished by the
	 * schedule it was walking back to, and stays out of sight for that update
	 * even when its schedule place is near, so a renderer lets go of the body
	 * before the schedule shows it again.
	 */
	updateVisible( request ) {

		this.boundary.input( 'visible-update', request );
		const controlled = new Set( [ this.follow?.npcId, this.conversation?.npcId, this.pose?.npcId ].filter( Boolean ) );
		const near = ( actor ) => distance( actor.position, request.playerPosition ) <= request.maxDistance;
		const states = [];
		for ( const [ npcId, actor ] of [ ...this.actors.entries() ].sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) ) ) {

			if ( controlled.has( npcId ) ) {

				states.push( clone( actor ) );
				continue;

			}
			const returning = this.returns.has( npcId );
			if ( this.holds.has( npcId ) || ( returning && near( actor ) ) ) {

				actor.visible = near( actor );
				states.push( clone( actor ) );
				continue;

			}
			this.returns.delete( npcId );
			try {

				const scheduled = this.#scheduledActor( npcId, request.timeMin );
				scheduled.visible = ! returning && near( scheduled );
				this.actors.set( npcId, scheduled );
				states.push( clone( scheduled ) );

			} catch {

				actor.visible = false;
				states.push( clone( actor ) );

			}

		}
		return this.boundary.output( 'actor-states', states );

	}

	/** Interrupts one NPC and routes it toward the player from where its body is. */
	startFollow( request ) {

		this.boundary.input( 'follow-start', request );
		this.#assertNoControl();
		const actor = this.#body( request.npcId, request.timeMin );
		if ( actor.place.kind === 'route' ) {

			throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${request.npcId} cannot start a walking follow while aboard transit` );

		}
		const route = this.routes.route( actor.position, request.playerPosition );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${request.npcId} cannot reach the player` );
		this.#take( actor, request.timeMin );
		actor.mode = 'following';
		actor.animation = route.distanceMeters > STOPPING_DISTANCE ? 'walk' : 'idle';
		this.follow = {
			npcId: actor.npcId, mode: 'following', phase: 'walking',
			route: savedRoute( route, request.playerPosition ), lastTimeMin: request.timeMin,
			...( request.pace ? { pace: { ...request.pace } } : {} )
		};
		return this.#actorOut( actor );

	}

	/** Interrupts one NPC and leads the player from where its body is to an exact authored place. */
	startLead( request ) {

		this.boundary.input( 'lead-start', request );
		this.#assertNoControl();
		const actor = this.#body( request.npcId, request.timeMin );
		if ( actor.place.kind === 'route' ) throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${request.npcId} cannot lead while aboard transit` );
		const destination = this.#locatePlace( request.destination, null ).position;
		const route = this.routes.route( actor.position, destination );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${request.npcId} cannot reach the escort destination` );
		this.#take( actor, request.timeMin );
		actor.mode = 'leading';
		actor.animation = route.distanceMeters > ARRIVAL_DISTANCE ? 'walk' : 'idle';
		this.follow = {
			npcId: actor.npcId, mode: 'leading', phase: 'walking',
			route: savedRoute( route, destination ), lastTimeMin: request.timeMin,
			destination: clone( request.destination ), pace: { ...( request.pace ?? LEAD_PACE ) }
		};
		return this.#actorOut( actor );

	}

	/** Attaches the exact active follower to a measured transit vehicle position. */
	carryFollower( request ) {

		this.boundary.input( 'follower-carry', request );
		if ( this.follow?.npcId !== request.npcId || this.follow.mode !== 'following' ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${request.npcId} is not following` );

		}
		const actor = this.actors.get( request.npcId );
		// Dialogue owns the physical body until close, even if transit is still
		// publishing a passenger location for the interrupted follower.
		if ( this.conversation?.npcId === actor.npcId ) return this.#actorOut( actor );
		actor.position = [ ...request.position ];
		actor.place = { kind: 'route', id: request.routeId };
		actor.mode = 'following';
		actor.animation = 'idle';
		actor.visible = true;
		this.follow.route = restingRoute( request.position, request.position );
		return this.#actorOut( actor );

	}

	/** Freezes one actual identity in crouch until its matching release. */
	startCrouch( request ) {

		this.boundary.input( 'crouch-start', request );
		this.#assertNoControl();
		const actor = this.#body( request.npcId, request.timeMin );
		if ( actor.place.kind === 'route' ) {

			throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${request.npcId} cannot crouch while aboard transit` );

		}
		this.#take( actor, request.timeMin );
		actor.mode = 'posing';
		actor.animation = selectNpcAnimation( { action: 'crouch' } );
		this.pose = { npcId: actor.npcId, kind: 'crouch', lastTimeMin: request.timeMin };
		return this.#actorOut( actor );

	}

	/** Releases the exact crouched identity and routes it back to its schedule. */
	releaseCrouch( request ) {

		this.boundary.input( 'crouch-stop', request );
		if ( ! this.pose || this.pose.npcId !== request.npcId ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${request.npcId} is not explicitly crouched` );

		}
		const actor = this.actors.get( request.npcId );
		this.#resume( actor.npcId, request.timeMin );
		this.pose = null;
		try { return this.#startResume( actor, request.timeMin ); }
		catch ( error ) {

			actor.mode = 'released';
			actor.animation = 'idle';
			throw error;

		}

	}

	/**
	 * Advances the companion and every walk home. Returns the companion's state,
	 * or null when there is none; phase changes wait in `drainEvents()`.
	 */
	updateFollow( request ) {

		this.boundary.input( 'follow-update', request );
		this.events = [];
		for ( const npcId of [ ...this.returns.keys() ].sort() ) this.#advanceReturn( this.actors.get( npcId ), request );
		if ( ! this.follow ) return this.#actorMaybeOut( null );
		const actor = this.actors.get( this.follow.npcId );
		this.follow.lastTimeMin = request.timeMin;
		if ( this.conversation?.npcId === actor.npcId ) {

			actor.mode = 'conversation';
			actor.animation = actor.animation === 'sit' ? 'sit' : 'idle';
			return this.#actorOut( actor );

		}
		try { this.#living( actor.npcId ); }
		catch {

			this.#giveUp( actor, request.timeMin, 'unavailable' );
			return this.#actorOut( actor );

		}
		if ( this.#lost( actor, request ) ) this.#giveUp( actor, request.timeMin, 'player-lost' );
		else if ( this.follow.mode === 'following' ) this.#advanceFollowing( actor, request );
		else this.#advanceLeading( actor, request );
		return this.#actorOut( actor );

	}

	/** Lets the companion go: the simulation resumes and it walks back into its day from where it stands. */
	stopFollow( request ) {

		this.boundary.input( 'follow-stop', request );
		if ( ! this.follow ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is following or leading' );
		if ( this.conversation?.npcId === this.follow.npcId ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'close the conversation before release' );
		const actor = this.actors.get( this.follow.npcId );
		this.#resume( actor.npcId, request.timeMin );
		this.follow = null;
		return this.#walkHome( actor, request.timeMin );

	}

	/**
	 * Puts one identity where a quest needs it and keeps it there. A held body
	 * is not reprojected onto its rota, so the person a step sends the player
	 * to is still standing there when the player arrives, and after they talk.
	 */
	hold( request ) {

		this.boundary.input( 'hold-start', request );
		const { npcId, timeMin } = request;
		if ( this.conversation?.npcId === npcId || this.follow?.npcId === npcId || this.pose?.npcId === npcId ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${npcId} is already under control` );

		}
		const held = this.holds.has( npcId );
		const actor = held ? this.actors.get( npcId ) : this.#scheduledActor( npcId, timeMin );
		if ( ! held ) this.#interrupt( npcId, timeMin );
		this.returns.delete( npcId );
		actor.position = [ ...request.position ];
		actor.heading = request.heading;
		actor.place = clone( request.place );
		delete actor.spot;
		actor.visible = true;
		actor.mode = 'posing';
		actor.animation = request.seated ? 'sit' : 'idle';
		actor.schedule = { ...actor.schedule, nextDestination: clone( request.place ) };
		this.actors.set( npcId, actor );
		this.holds.set( npcId, { npcId, lastTimeMin: timeMin } );
		return this.#actorOut( actor );

	}

	/** Lets a held identity go: it walks from where it stands back into its day. */
	releaseHold( request ) {

		this.boundary.input( 'hold-release', request );
		if ( ! this.holds.has( request.npcId ) ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${request.npcId} is not held` );

		}
		const actor = this.actors.get( request.npcId );
		this.holds.delete( request.npcId );
		this.#resume( actor.npcId, request.timeMin );
		return this.#startResume( actor, request.timeMin, { keepPost: true } );

	}

	beginConversation( request ) {

		this.boundary.input( 'conversation-start', request );
		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is already in conversation` );
		if ( this.pose ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.pose.npcId} has an explicit pose` );
		const companion = this.follow?.npcId === request.npcId;
		const held = this.holds.has( request.npcId );
		// The visible body is authoritative at interaction time. Re-projecting
		// its off-shift schedule here can fail on a distant unloaded place, or
		// replace an existing return path before control has been acquired.
		const actor = this.actors.get( request.npcId ) ?? this.#scheduledActor( request.npcId, request.timeMin );
		if ( request.post && ! companion && ! held && request.place.kind === 'parcel' ) {

			const state = this.simulation.continuityAt( request.npcId, request.timeMin );
			const { entryIndex, startMin, endMin } = state.schedule;
			this.posts.set( request.npcId, {
				npcId: request.npcId, place: clone( request.place ), position: [ ...request.position ],
				schedulePlace: clone( state.behavior.place ),
				heading: request.post.heading, animation: request.seated ? 'sit' : 'idle',
				entryIndex, startMin, endMin,
				...( request.post.spot ? { spot: request.post.spot } : {} )
			} );

		}
		if ( ! companion && ! held ) this.#interrupt( request.npcId, request.timeMin );
		this.returns.delete( request.npcId );
		this.holds.delete( request.npcId );
		// A companion moved by the dialogue plans its way on from where it now stands.
		if ( companion && distance( actor.position, request.position ) > ARRIVAL_DISTANCE ) {

			this.follow.route = restingRoute( request.position, this.follow.route.destination );

		}
		actor.position = [ ...request.position ];
		actor.heading = request.heading;
		actor.place = clone( request.place );
		actor.visible = true;
		actor.mode = 'conversation';
		actor.animation = request.seated ? 'sit' : 'idle';
		if ( this.posts.get( actor.npcId )?.spot ) actor.spot = this.posts.get( actor.npcId ).spot;
		this.actors.set( actor.npcId, actor );
		this.conversation = {
			npcId: actor.npcId,
			ownsInterruption: ! companion,
			lastTimeMin: request.timeMin
		};
		return this.#actorOut( actor );

	}

	/**
	 * Closes the conversation. A companion goes back to following or leading;
	 * anybody else walks back into their day on their own, leaving the
	 * companion as it was. @param request.hold keeps the body where it stands.
	 */
	endConversation( request ) {

		this.boundary.input( 'conversation-stop', request );
		if ( ! this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is in conversation' );
		const conversation = this.conversation;
		const actor = this.actors.get( conversation.npcId );
		this.conversation = null;
		if ( ! conversation.ownsInterruption ) {

			actor.mode = this.follow.mode;
			actor.animation = 'idle';
			return this.#actorOut( actor );

		}
		if ( request.hold ) {

			actor.mode = 'posing';
			actor.animation = actor.animation === 'sit' ? 'sit' : 'idle';
			this.holds.set( actor.npcId, { npcId: actor.npcId, lastTimeMin: request.timeMin } );
			return this.#actorOut( actor );

		}
		this.#resume( actor.npcId, request.timeMin );
		return this.#startResume( actor, request.timeMin, { keepPost: true } );

	}

	serialize() {

		const byId = ( a, b ) => a.npcId.localeCompare( b.npcId );
		return this.boundary.output( 'continuity-save', {
			version: '2',
			actors: [ ...this.actors.values() ].sort( byId ).map( clone ),
			follow: this.follow ? clone( this.follow ) : null,
			returns: [ ...this.returns.values() ].sort( byId ).map( clone ),
			conversation: this.conversation ? clone( this.conversation ) : null,
			pose: this.pose ? clone( this.pose ) : null,
			holds: [ ...this.holds.values() ].sort( byId ).map( clone ),
			...( this.posts.size ? { posts: [ ...this.posts.values() ].sort( byId ).map( clone ) } : {} )
		} );

	}

	/** Restores a prior `serialize()` output; a version 1 save is upgraded first. */
	restore( input ) {

		this.boundary.input( 'continuity-save', input );
		const save = input.version === '1' ? upgradeSave( input ) : input;
		const ids = new Set();
		const controlled = [ save.follow, save.conversation, save.pose ].filter( Boolean ).map( ( control ) => control.npcId );
		for ( const actor of save.actors ) {

			if ( ids.has( actor.npcId ) ) throw new NpcContinuityError( 'E_NPC_INPUT', `duplicate actor ${actor.npcId}` );
			ids.add( actor.npcId );
			let npc;
			try { npc = this.simulation.getNPC( actor.npcId ); }
			catch { throw new NpcContinuityError( 'E_NPC_INPUT', `save actor ${actor.npcId} is not present in the restored simulation` ); }
			if ( controlled.includes( actor.npcId ) && npc.flags?.dead ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `controlled save actor ${actor.npcId} is dead` );

			}
			if ( npc.appearanceSeed !== actor.appearanceSeed || npc.gender !== actor.gender || npc.type !== actor.type ||
				npc.name.given !== actor.name.given || npc.name.family !== actor.name.family ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `save actor ${actor.npcId} does not match its simulation identity` );

			}

		}
		for ( const [ kind, control ] of [ [ 'follow', save.follow ], [ 'conversation', save.conversation ], [ 'pose', save.pose ] ] ) {

			if ( control && ! ids.has( control.npcId ) ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `${kind} state references missing actor ${control.npcId}` );

			}

		}
		if ( save.pose && ( save.follow || save.conversation ) ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', 'pose state conflicts with another NPC control state' );

		}
		if ( save.conversation && ! save.conversation.ownsInterruption && save.follow?.npcId !== save.conversation.npcId ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', `conversation with ${save.conversation.npcId} leaves no companion to return to` );

		}
		if ( save.pose ) {

			const posed = save.actors.find( ( actor ) => actor.npcId === save.pose.npcId );
			if ( posed.mode !== 'posing' || posed.animation !== 'crouch' || ! posed.visible ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `pose state disagrees with actor ${save.pose.npcId}` );

			}

		}
		const heldIds = new Set();
		for ( const [ kind, entry ] of [
			...( save.holds ?? [] ).map( ( hold ) => [ 'hold', hold ] ),
			...save.returns.map( ( walk ) => [ 'return', walk ] )
		] ) {

			if ( ! ids.has( entry.npcId ) ) throw new NpcContinuityError( 'E_NPC_INPUT', `${kind} state references missing actor ${entry.npcId}` );
			if ( controlled.includes( entry.npcId ) || heldIds.has( entry.npcId ) ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `${kind} actor ${entry.npcId} also has another control state` );

			}
			heldIds.add( entry.npcId );

		}
		const unownedPose = save.actors.find( ( actor ) => actor.mode === 'posing' && save.pose?.npcId !== actor.npcId &&
			! ( save.holds ?? [] ).some( ( hold ) => hold.npcId === actor.npcId ) );
		if ( unownedPose ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', `posing actor ${unownedPose.npcId} has no matching pose state` );

		}
		const interrupted = new Set( ( save.holds ?? [] ).map( ( hold ) => hold.npcId ) );
		if ( save.follow ) interrupted.add( save.follow.npcId );
		if ( save.conversation?.ownsInterruption ) interrupted.add( save.conversation.npcId );
		if ( save.pose ) interrupted.add( save.pose.npcId );
		for ( const npcId of interrupted ) if ( ! this.simulation.behaviorAt( npcId, 0 )?.interrupted ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', `controlled save actor ${npcId} is not interrupted in the restored simulation` );

		}
		const postIds = new Set();
		for ( const post of save.posts ?? [] ) {

			if ( ! ids.has( post.npcId ) || postIds.has( post.npcId ) || post.endMin <= post.startMin ) {
				throw new NpcContinuityError( 'E_NPC_INPUT', `invalid scheduled post for ${post.npcId}` );
			}
			postIds.add( post.npcId );

		}
		this.actors = new Map( save.actors.map( ( actor ) => [ actor.npcId, clone( actor ) ] ) );
		this.follow = save.follow ? clone( save.follow ) : null;
		this.returns = new Map( save.returns.map( ( walk ) => [ walk.npcId, clone( walk ) ] ) );
		this.conversation = save.conversation ? clone( save.conversation ) : null;
		this.pose = save.pose ? clone( save.pose ) : null;
		this.holds = new Map( ( save.holds ?? [] ).map( ( hold ) => [ hold.npcId, clone( hold ) ] ) );
		this.posts = new Map( ( save.posts ?? [] ).map( ( post ) => [ post.npcId, clone( post ) ] ) );
		this.events = [];
		return this.serialize();

	}

	/** Walks toward the player over the cached route, running when far and stopping short of them. */
	#advanceFollowing( actor, request ) {

		const follow = this.follow;
		const route = this.#plan( follow, actor, request.playerPosition, FOLLOW_REPLAN );
		if ( ! route ) return this.#giveUp( actor, request.timeMin, 'unreachable' );
		const remaining = route.distanceMeters - route.cursor;
		const toGo = Math.max( 0, remaining - STOPPING_DISTANCE );
		const speed = remaining > RUN_DISTANCE ? RUN_SPEED : toGo > EPSILON ? WALK_SPEED : 0;
		this.#walk( actor, route, Math.min( toGo, speed * request.deltaSeconds ) );
		actor.animation = selectNpcAnimation( { speed } );
		actor.mode = 'following';
		this.#phase( speed > 0 ? 'walking' : 'waiting', request.timeMin );

	}

	/**
	 * Walks ahead of the player to the destination at the player's pace: full
	 * speed with the player close or ahead on the path, slower as the player
	 * lags, then stopped and facing them until they catch up. Arrival is
	 * final: the leader stays where it stands, even where a conversation moved
	 * it, facing the player until released.
	 */
	#advanceLeading( actor, request ) {

		const lead = this.follow;
		const player = request.playerPosition;
		actor.mode = 'leading';
		if ( lead.phase === 'arrived' ) {

			actor.heading = headingTo( actor.position, player, actor.heading );
			actor.animation = 'idle';
			return;

		}
		const route = this.#plan( lead, actor, lead.route.destination, ARRIVAL_DISTANCE );
		if ( ! route ) return this.#giveUp( actor, request.timeMin, 'unreachable' );
		const gap = distance( actor.position, player );
		let speed = 0;
		if ( gap <= LEAD_SLOW_FROM ) speed = WALK_SPEED;
		else if ( playerAhead( route, player ) ) speed = gap > RUN_DISTANCE ? RUN_SPEED : WALK_SPEED;
		else if ( gap <= ( lead.phase === 'waiting' ? LEAD_RESUME_WITHIN : LEAD_WAIT_BEYOND ) ) {

			speed = WALK_SPEED - ( WALK_SPEED - SLOW_SPEED ) * Math.min( 1, ( gap - LEAD_SLOW_FROM ) / ( LEAD_WAIT_BEYOND - LEAD_SLOW_FROM ) );

		}
		this.#walk( actor, route, Math.min( route.distanceMeters - route.cursor, speed * request.deltaSeconds ) );
		if ( route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE ) {

			if ( lead.destination ) actor.place = clone( lead.destination );
			actor.heading = headingTo( actor.position, player, actor.heading );
			actor.animation = 'idle';
			this.#phase( 'arrived', request.timeMin );
			return;

		}
		if ( speed === 0 ) actor.heading = headingTo( actor.position, player, actor.heading );
		actor.animation = selectNpcAnimation( { speed } );
		this.#phase( speed > 0 ? 'walking' : 'waiting', request.timeMin );

	}

	#advanceReturn( actor, request ) {

		const walk = this.returns.get( actor.npcId );
		let scheduled;
		try { scheduled = this.#resumeTarget( actor, request.timeMin ); }
		catch { return this.#dropReturn( actor ); }
		const route = this.#plan( walk, actor, scheduled.position, RETURN_REPLAN );
		if ( ! route ) return this.#dropReturn( actor );
		const travel = Math.min( route.distanceMeters - route.cursor, WALK_SPEED * request.deltaSeconds );
		this.#walk( actor, route, travel );
		actor.animation = travel > 0 ? 'walk' : scheduled.animation;
		actor.schedule = scheduled.schedule;
		actor.mode = 'resuming';
		if ( route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE && distance( route.destination, scheduled.position ) <= ARRIVAL_DISTANCE ) {

			this.#finishResume( actor, scheduled );

		}

	}

	#dropReturn( actor ) {

		this.returns.delete( actor.npcId );
		actor.mode = 'released';
		actor.animation = 'idle';

	}

	/**
	 * The record's cached route, planned again from the body only when its
	 * target has moved past `replanBeyond`, or when the route has run out short
	 * of the target.
	 */
	#plan( record, actor, target, replanBeyond ) {

		const route = record.route;
		const exhausted = route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE;
		if ( distance( route.destination, target ) <= replanBeyond &&
			! ( exhausted && distance( actor.position, target ) > ARRIVAL_DISTANCE ) ) return route;
		const planned = this.routes.route( actor.position, target );
		if ( ! planned ) return null;
		record.route = savedRoute( planned, target );
		return record.route;

	}

	/** Moves the body `travel` metres on along its cached route. */
	#walk( actor, route, travel ) {

		if ( ! ( travel > 0 ) ) return;
		route.cursor = Math.min( route.distanceMeters, route.cursor + travel );
		const moved = pointAtDistance( route.path3, route.cursor );
		actor.position = moved.position;
		actor.heading = moved.heading ?? actor.heading;
		this.#putOnWalkGraph( actor );

	}

	/** Whether the player has stayed beyond the companion's give-up distance for its give-up time. */
	#lost( actor, request ) {

		const follow = this.follow;
		if ( ! follow.pace || distance( actor.position, request.playerPosition ) <= follow.pace.giveUpBeyond ) {

			delete follow.lostSinceMin;
			return false;

		}
		follow.lostSinceMin ??= request.timeMin;
		return request.timeMin - follow.lostSinceMin >= follow.pace.giveUpAfterMin;

	}

	/**
	 * Ends the companion on its own: the host hears why through a 'gave-up'
	 * event, the simulation resumes, and the body walks back into its day
	 * when it can.
	 */
	#giveUp( actor, timeMin, reason ) {

		const { npcId, mode } = this.follow;
		this.follow = null;
		this.events.push( { npcId, mode, phase: 'gave-up', timeMin, reason } );
		try { this.simulation.resume( npcId, timeMin ); } catch {}
		this.#walkHome( actor, timeMin );

	}

	/** Starts the walk back into the day, or leaves the body released where it stands when it has none. */
	#walkHome( actor, timeMin ) {

		try { return this.#startResume( actor, timeMin ); }
		catch {

			actor.mode = 'released';
			actor.animation = 'idle';
			return this.#actorOut( actor );

		}

	}

	#phase( phase, timeMin ) {

		const follow = this.follow;
		if ( follow.phase === phase ) return;
		follow.phase = phase;
		this.events.push( { npcId: follow.npcId, mode: follow.mode, phase, timeMin } );

	}

	/**
	 * Hands a released body back to its schedule: straight onto its post, or
	 * as a walk home of its own that no companion or other walk waits on.
	 * @param options.keepPost keeps a parcel body at its post when no way home exists
	 */
	#startResume( actor, timeMin, { keepPost = false } = {} ) {

		const keep = keepPost && actor.place.kind === 'parcel';
		let scheduled;
		try { scheduled = this.#resumeTarget( actor, timeMin ); }
		catch ( error ) {

			if ( keep ) return this.#keepUnroutablePost( actor, timeMin );
			throw error;

		}
		if ( this.posts.has( actor.npcId ) && distance( actor.position, scheduled.position ) <= ARRIVAL_DISTANCE ) {

			// Resuming a worker or seated visitor at their actual post needs no
			// detour onto the street graph.
			Object.assign( actor, scheduled, { visible: actor.visible, mode: 'schedule' } );
			return this.#actorOut( actor );

		}
		const route = this.routes.route( actor.position, scheduled.position );
		if ( ! route ) {

			if ( keep ) return this.#keepUnroutablePost( actor, timeMin );
			throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${actor.npcId} cannot resume its schedule` );

		}
		if ( route.distanceMeters <= ARRIVAL_DISTANCE ) {

			this.#finishResume( actor, scheduled );
			return this.#actorOut( actor );

		}
		actor.mode = 'resuming';
		actor.animation = 'walk';
		actor.schedule = scheduled.schedule;
		this.returns.set( actor.npcId, { npcId: actor.npcId, route: savedRoute( route, scheduled.position ) } );
		return this.#actorOut( actor );

	}

	/** Old saves lack a post record. A missing exit route must not erase the
	 * person or abort loading; retain the visible post for this occurrence. */
	#keepUnroutablePost( actor, timeMin ) {

		const state = this.simulation.continuityAt( actor.npcId, timeMin );
		const { entryIndex, startMin, endMin } = state.schedule;
		actor.mode = 'schedule';
		actor.animation = actor.animation === 'sit' ? 'sit' : 'idle';
		actor.schedule = clone( state.schedule );
		this.posts.set( actor.npcId, {
			npcId: actor.npcId, place: clone( actor.place ), position: [ ...actor.position ], heading: actor.heading,
			animation: actor.animation, schedulePlace: clone( state.behavior.place ), entryIndex, startMin, endMin,
			...( actor.spot ? { spot: actor.spot } : {} )
		} );
		return this.#actorOut( actor );

	}

	#finishResume( actor, scheduled ) {

		const visible = actor.visible;
		if ( ! scheduled.spot ) delete actor.spot;
		Object.assign( actor, scheduled, { visible, mode: 'schedule' } );
		this.returns.delete( actor.npcId );

	}

	#resumeTarget( actor, timeMin ) {

		try {

			const scheduled = this.#scheduledActor( actor.npcId, timeMin );
			return scheduled.place.kind === 'route' ? this.#destinationActor( actor, timeMin ) : scheduled;

		} catch ( error ) {

			if ( error?.code !== 'E_NPC_PLACE' ) throw error;
			return this.#destinationActor( actor, timeMin );

		}

	}

	/**
	 * The body a new control starts from: the one on screen, held by a quest
	 * or walking home, where it stands; otherwise the schedule's projection.
	 */
	#body( npcId, timeMin ) {

		const actor = this.actors.get( npcId );
		if ( ! actor || ! ( actor.visible || this.holds.has( npcId ) || this.returns.has( npcId ) ) ) {

			return this.#scheduledActor( npcId, timeMin );

		}
		this.#living( npcId );
		return actor;

	}

	/** Takes a body under control: a held one keeps its interruption, anybody else is interrupted now. */
	#take( actor, timeMin ) {

		if ( ! this.holds.delete( actor.npcId ) ) this.#interrupt( actor.npcId, timeMin );
		this.returns.delete( actor.npcId );
		actor.visible = true;
		this.actors.set( actor.npcId, actor );

	}

	#assertNoControl() {

		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is in conversation` );
		if ( this.follow ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.follow.npcId} is already ${this.follow.mode}` );
		if ( this.pose ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.pose.npcId} has an explicit pose` );

	}

	/** The simulation instance of a live identity. */
	#living( npcId ) {

		let npc;
		try { npc = this.simulation.getNPC( npcId ); }
		catch ( error ) {

			throw new NpcContinuityError( error?.code === 'E_UNKNOWN_ID' ? 'E_NPC_UNKNOWN' : 'E_NPC_UNAVAILABLE', messageOf( error ) );

		}
		if ( npc.flags?.dead ) throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', `NPC ${npcId} is dead` );
		return npc;

	}

	#scheduledActor( npcId, timeMin ) {

		const npc = this.#living( npcId );
		let state;
		try { state = this.simulation.continuityAt( npcId, timeMin ); }
		catch ( error ) {

			throw new NpcContinuityError( error?.code === 'E_UNKNOWN_ID' ? 'E_NPC_UNKNOWN' : 'E_NPC_UNAVAILABLE', messageOf( error ) );

		}
		let post = this.posts.get( npcId );
		if ( post && ( placeKey( post.schedulePlace ?? post.place ) !== placeKey( state.behavior.place ) ||
			post.entryIndex !== state.schedule.entryIndex || post.startMin !== state.schedule.startMin || post.endMin !== state.schedule.endMin ) ) {

			this.posts.delete( npcId );
			post = null;

		}
		const located = post ? clone( post ) : this.#locate( npc, state );
		return {
			npcId: npc.npcId,
			name: clone( npc.name ),
			gender: npc.gender,
			type: npc.type,
			appearanceSeed: npc.appearanceSeed,
			place: located.place,
			position: located.position,
			heading: located.heading,
			animation: post?.animation ?? state.animation,
			...( post?.spot ? { spot: post.spot } : {} ),
			mode: 'schedule',
			schedule: clone( state.schedule ),
			visible: false
		};

	}

	#destinationActor( actor, timeMin ) {

		let state;
		try {

			state = this.simulation.continuityAt( actor.npcId, timeMin );

		} catch ( error ) {

			throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', messageOf( error ) );

		}
		const place = state.schedule.nextDestination;
		const located = this.#locatePlace( place, null );
		return { ...clone( actor ), place, position: located.position, heading: located.heading, schedule: clone( state.schedule ), animation: 'idle' };

	}

	#locate( npc, state ) {

		if ( state.movement ) {

			const current = state.movement.current;
			const edge = this.routes.edges.get( current.edgeId );
			if ( ! edge ) throw new NpcContinuityError( 'E_NPC_PLACE', `scheduled edge ${current.edgeId} is unavailable` );
			const point = this.routes.pointAt( edge, edge.length * current.progress, 1 );
			return { place: { kind: 'edge', id: edge.id }, position: [ point.x, point.y, point.z ], heading: point.heading };

		}
		if ( state.behavior.place.kind === 'route' ) return this.#locateTransit( npc, state );
		return { place: clone( state.behavior.place ), ...this.#locatePlace( state.behavior.place, state.behavior.interior ) };

	}

	#locateTransit( npc, state ) {

		const routeId = state.behavior.place.id;
		const entry = npc.routine?.[ state.schedule.entryIndex ];
		const leg = entry?.transitLeg;
		if ( ! leg || leg.routeId !== routeId ) {

			throw new NpcContinuityError( 'E_NPC_PLACE', `route ${routeId} has no scheduled passenger leg for NPC ${npc.npcId}` );

		}
		const route = this.transitRoutes.get( routeId );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PLACE', `scheduled transit route ${routeId} is unavailable` );
		const point = transitPoint( route, leg.boardStopId, leg.alightStopId, state.schedule.progress );
		if ( ! point ) {

			throw new NpcContinuityError( 'E_NPC_PLACE', `scheduled transit route ${routeId} has incomplete path3 or timing facts` );

		}
		return { place: clone( state.behavior.place ), position: point.position, heading: point.heading };

	}

	#locatePlace( place, interior ) {

		if ( place.kind === 'route' ) throw new NpcContinuityError( 'E_NPC_PLACE', `route ${place.id} has no destination walk position` );
		const known = this.places.get( placeKey( place ) );
		if ( interior && 'at' in interior ) {

			const anchor = known?.anchors?.find( ( candidate ) => candidate.id === interior.at.anchorId );
			if ( anchor ) return { position: [ ...anchor.position ], heading: anchor.heading ?? 0 };

		}
		if ( known ) return { position: [ ...known.position ], heading: known.heading ?? 0 };
		const node = [ ...this.routes.nodes.values() ]
			.filter( ( candidate ) => candidate.ref === place.id )
			.sort( ( a, b ) => a.id.localeCompare( b.id ) )[ 0 ];
		if ( node ) return { position: [ node.x, node.y, node.z ], heading: 0 };
		if ( place.kind === 'edge' ) {

			const edge = this.routes.edges.get( place.id );
			if ( edge ) {

				const point = this.routes.pointAt( edge, edge.length / 2, 1 );
				return { position: [ point.x, point.y, point.z ], heading: point.heading };

			}

		}
		throw new NpcContinuityError( 'E_NPC_PLACE', `${place.kind} ${place.id} has no available position` );

	}

	#putOnWalkGraph( actor ) {

		const projection = this.routes.project( actor.position );
		if ( projection ) actor.place = { kind: 'edge', id: projection.edge.id };

	}

	/** Whether some control is already keeping this identity out of its rota. */
	#controls( npcId ) {

		return this.follow?.npcId === npcId || this.conversation?.npcId === npcId ||
			this.pose?.npcId === npcId || this.holds.has( npcId );

	}

	#interrupt( npcId, timeMin ) {

		try { this.simulation.interrupt( npcId, timeMin ); }
		catch ( error ) { throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', messageOf( error ) ); }

	}

	#resume( npcId, timeMin ) {

		try { this.simulation.resume( npcId, timeMin ); }
		catch ( error ) { throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', messageOf( error ) ); }

	}

	#actorOut( actor ) {

		this.#clearStaleSpot( actor );
		return this.boundary.output( 'actor-state', clone( actor ) );

	}

	#actorMaybeOut( actor ) {

		if ( actor ) this.#clearStaleSpot( actor );
		return this.boundary.output( 'actor-state-or-null', actor ? clone( actor ) : null );

	}

	#clearStaleSpot( actor ) {

		const post = this.posts.get( actor.npcId );
		if ( actor.spot && ( ! post || placeKey( actor.place ) !== placeKey( post.place ) || distance( actor.position, post.position ) > 0.01 ) ) {
			delete actor.spot;
		}

	}

}

/** Crouch is selected only by an explicit contextual action request. */
export function selectNpcAnimation( { speed = 0, seated = false, action = null } = {} ) {

	if ( action === 'crouch' ) return 'crouch';
	if ( seated ) return 'sit';
	if ( speed > WALK_SPEED ) return 'run';
	if ( speed > 0 ) return 'walk';
	return 'idle';

}

function pointAtDistance( path, distanceAlong ) {

	if ( path.length === 1 ) return { position: [ ...path[ 0 ] ], heading: null };
	let remaining = Math.max( 0, distanceAlong );
	for ( let index = 1; index < path.length; index ++ ) {

		const a = path[ index - 1 ];
		const b = path[ index ];
		const span = distance( a, b );
		if ( remaining <= span || index === path.length - 1 ) {

			const t = span > 0 ? Math.min( 1, remaining / span ) : 0;
			return { position: lerp( a, b, t ), heading: Math.atan2( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] ) };

		}
		remaining -= span;

	}
	return { position: [ ...path.at( - 1 ) ], heading: null };

}

function savedRoute( route, destination ) {

	return {
		path3: route.path3.map( ( point ) => [ ...point ] ),
		distanceMeters: route.distanceMeters,
		cursor: 0,
		destination: [ ...destination ]
	};

}

/** A route standing at one point, planned again on the next update that needs to move. */
function restingRoute( position, destination ) {

	return { path3: [ [ ...position ] ], distanceMeters: 0, cursor: 0, destination: [ ...destination ] };

}

/** Whether the player stands beside the rest of the route, ahead of the walker on it. */
function playerAhead( route, player ) {

	let before = 0;
	for ( let index = 1; index < route.path3.length; index ++ ) {

		const a = route.path3[ index - 1 ];
		const b = route.path3[ index ];
		const span = distance( a, b );
		if ( before + span > route.cursor ) {

			const t = span > 0 ? Math.max( 0, Math.min( 1, dot( player, a, b ) / ( span * span ) ) ) : 0;
			const along = before + span * t;
			if ( along > route.cursor + ARRIVAL_DISTANCE && distance( player, lerp( a, b, t ) ) <= LEAD_PATH_WIDTH ) return true;

		}
		before += span;

	}
	return false;

}

/** Upgrades a version 1 save: its single slot held either the companion or one walk home. */
function upgradeSave( save ) {

	const { follow, ...rest } = save;
	const returning = follow?.mode === 'resuming';
	return {
		...rest,
		version: '2',
		follow: ! follow || returning ? null : {
			npcId: follow.npcId, mode: follow.mode, phase: 'walking', route: follow.route, lastTimeMin: follow.lastTimeMin,
			...( follow.mode === 'leading' ? { pace: { ...LEAD_PACE } } : {} )
		},
		returns: returning ? [ { npcId: follow.npcId, route: follow.route } ] : []
	};

}

/** Scheduled passenger position over one ordered portion of a Connections transit shape. */
function transitPoint( route, boardStopId, alightStopId, progress ) {

	if ( ! Array.isArray( route.shape ) || route.shape.length < 2 ||
		! route.shape.every( validPoint ) || ! Array.isArray( route.stops ) ||
		! Array.isArray( route.template ) || route.template.length !== route.stops.length ||
		! Array.isArray( route.service ) || route.service.length === 0 ) return null;
	const pairs = [];
	for ( let board = 0; board < route.stops.length - 1; board ++ ) {

		if ( route.stops[ board ].stopId !== boardStopId ) continue;
		for ( let alight = board + 1; alight < route.stops.length; alight ++ ) {

			if ( route.stops[ alight ].stopId === alightStopId ) pairs.push( { board, alight } );

		}

	}
	if ( ! pairs.length ) return null;
	pairs.sort( ( a, b ) => ( a.alight - a.board ) - ( b.alight - b.board ) || a.board - b.board );
	const { board, alight } = pairs[ 0 ];
	const shapeLength = pathDistance( route.shape );
	const legs = [];
	let totalSeconds = 0;
	for ( let index = board + 1; index <= alight; index ++ ) {

		const from = route.stops[ index - 1 ];
		const to = route.stops[ index ];
		const previous = route.template[ index - 1 ];
		const arrival = route.template[ index ];
		const seconds = arrival?.arrive - previous?.depart;
		if ( ! Number.isFinite( from.shapeDist ) || ! Number.isFinite( to.shapeDist ) ||
			to.shapeDist <= from.shapeDist || to.shapeDist > shapeLength + 1e-6 ||
			! Number.isFinite( seconds ) || seconds <= 0 ) return null;
		legs.push( { from: from.shapeDist, to: to.shapeDist, seconds } );
		totalSeconds += seconds;

	}
	if ( ! Number.isFinite( totalSeconds ) || totalSeconds <= 0 ) return null;
	let remaining = Math.max( 0, Math.min( 1, progress ) ) * totalSeconds;
	for ( const leg of legs ) {

		if ( remaining <= leg.seconds || leg === legs.at( - 1 ) ) {

			const ratio = Math.min( 1, remaining / leg.seconds );
			return pointAtDistance( route.shape, leg.from + ( leg.to - leg.from ) * ratio );

		}
		remaining -= leg.seconds;

	}
	return null;

}

function validPoint( point ) {

	return Array.isArray( point ) && point.length === 3 && point.every( Number.isFinite );

}

function pathDistance( path ) {

	let total = 0;
	for ( let index = 1; index < path.length; index ++ ) total += distance( path[ index - 1 ], path[ index ] );
	return total;

}

function headingTo( from, to, fallback ) {

	const dx = to[ 0 ] - from[ 0 ];
	const dz = to[ 2 ] - from[ 2 ];
	return Math.hypot( dx, dz ) > 1e-6 ? Math.atan2( dx, dz ) : fallback;

}

function lerp( a, b, t ) { return [ a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t, a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t, a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t ]; }
function dot( point, a, b ) {

	return ( point[ 0 ] - a[ 0 ] ) * ( b[ 0 ] - a[ 0 ] ) + ( point[ 1 ] - a[ 1 ] ) * ( b[ 1 ] - a[ 1 ] ) + ( point[ 2 ] - a[ 2 ] ) * ( b[ 2 ] - a[ 2 ] );

}
function placeKey( place ) { return `${place.kind}:${place.id}`; }
function distance( a, b ) { return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ); }
function clone( value ) { return structuredClone( value ); }
function messageOf( error ) { return error instanceof Error ? error.message : String( error ); }
