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
/** Without a way inside, a follower walks in after a player on the ground floor only this far from the door. */
const DOOR_REACH = 12;
/** A follower that found no way to the player inside tries again once the player has moved this far. */
const INDOOR_RETRY = 2;
/** A companion with a pace that runs keeps up with a player going faster than this, and jogs here when in a hurry. */
const PLAYER_RUNNING = 2;
const JOG_SPEED = 2;
/** A visible scheduled body whose schedule moves it further than this in one update walks there instead of jumping. */
const JUMP = 1.5;
/** A walker asks a door ahead to open from this far, and waits this short of it until it does. */
const DOOR_LOOK = 2.5;
const DOOR_SHORT = 0.6;
/** Game minutes a walker waits in a lift car that does not arrive before it steps out where the shaft lets it. */
const LIFT_PATIENCE_MIN = 3;
/** A leader taking the player to a person stops this short of them, and walks on once they have moved this far. */
const PERSON_REACH = 1.6;
const PERSON_REPLAN = 1.5;
/**
 * How long, in seconds, a person the player has just been with stands where
 * they were let go, turned to the player, before walking back into their day:
 * the `linger` hosts pass when a talk closes or a companion is let go.
 */
export const LINGER_SECONDS = 5;

/**
 * Persistent materialization and control of actual simulation NPC ids: one
 * companion following or leading the player, walks home, conversation, crouch
 * and quest holds. It owns no population or schedule data: every scheduled
 * state is projected from the simulation, and every moving point is sampled
 * from the Connections walk graph supplied through WalkRoutes.
 */
export class NpcContinuity {

	/**
	 * @param interiorRoutes optional walks inside buildings: `covers(parcelId)`
	 *   and `route(parcelId, from, to)`, a world `{ path3, gates? }` or null
	 * @param ways optional doors and lifts the walkers pass: `pass(npcId, gate)`
	 *   asks a door gate open and says whether the body may go through, and
	 *   `ride(npcId, gate, stage)` runs a lift gate: `call` answers `wait` or
	 *   `board`, `ride` the car's `{ y }` or `alight`, `done` lets it go; null
	 *   from either means no such door or lift is there to run, and the walker
	 *   walks the way as drawn
	 */
	constructor( { simulation, routes, places = [], interiorRoutes = null, ways = null, boundary = new NpcContinuityBoundary() } ) {

		this.simulation = simulation;
		this.routes = routes;
		this.interiorRoutes = interiorRoutes;
		this.ways = ways;
		this.boundary = boundary;
		const networks = this.boundary.input( 'movement-network', routes.networks );
		this.transitRoutes = new Map( ( networks.transit?.routes ?? [] ).map( ( route ) => [ route.id, route ] ) );
		this.places = new Map( this.boundary.input( 'places', places ).map( ( place ) => [ placeKey( place ), place ] ) );
		this.actors = new Map();
		/** The one companion following or leading the player. */
		this.follow = null;
		/** Identities walking from where control let them go back into their day, by npcId. */
		this.returns = new Map();
		/** Identities on an errand of their own for the player: walking to a spot and staying there, by npcId. */
		this.errands = new Map();
		/** The clock and frame of the latest updateFollow, and where the player stood then, for gates and pace. */
		this.now = 0;
		this.delta = 0;
		this.player = null;
		this.conversation = null;
		this.pose = null;
		/** Identities a quest is keeping where they stand, by npcId. */
		this.holds = new Map();
		/** Rendered staff/chair placements, valid only for one schedule occurrence. */
		this.posts = new Map();
		/** Companion phase changes since the latest updateFollow began. */
		this.events = [];
		/** Where the player stood the last time no way inside led to them, so the follower waits instead of asking every frame. */
		this.indoorMiss = null;

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
		if ( this.#controls( npcId ) || this.returns.has( npcId ) || this.errands.has( npcId ) ) {

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
			if ( this.holds.has( npcId ) || this.errands.has( npcId ) || ( returning && near( actor ) ) ) {

				actor.visible = near( actor );
				states.push( clone( actor ) );
				continue;

			}
			this.returns.delete( npcId );
			try {

				const scheduled = this.#scheduledActor( npcId, request.timeMin );
				// A body the player can see is never moved more than a step by its schedule: it walks there, through doors.
				if ( ! returning && actor.visible && actor.mode === 'schedule' && near( actor ) && this.#walkOver( actor, scheduled ) ) {

					states.push( clone( actor ) );
					continue;

				}
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

	/**
	 * Interrupts one NPC and routes it toward the player from where its body
	 * is. The companion itself may be asked: it turns to following where it
	 * stands, keeping its interruption.
	 */
	startFollow( request ) {

		this.boundary.input( 'follow-start', request );
		this.#assertFree( request.npcId );
		const actor = this.#body( request.npcId, request.timeMin );
		if ( actor.place.kind === 'route' ) {

			throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${request.npcId} cannot start a walking follow while aboard transit` );

		}
		const route = this.#followRoute( null, actor, request ).route;
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${request.npcId} cannot reach the player` );
		this.#take( actor, request.timeMin );
		actor.mode = 'following';
		actor.animation = route.distanceMeters > STOPPING_DISTANCE ? 'walk' : 'idle';
		this.follow = {
			npcId: actor.npcId, mode: 'following', phase: 'walking', route, lastTimeMin: request.timeMin,
			...( request.pace ? { pace: { ...request.pace } } : {} )
		};
		return this.#actorOut( actor );

	}

	/**
	 * Interrupts one NPC and leads the player from where its body is to an
	 * exact authored place: outside its entrance, or with `target` to a point
	 * inside it (an apartment door, a work spot, a lift landing), in through
	 * the door, up the stairs or the lift, once the building can be walked; or
	 * to a person (`target.npcId`), wherever they are and as they move. The
	 * companion itself may be asked: it turns to leading where it stands,
	 * keeping its interruption.
	 */
	startLead( request ) {

		this.boundary.input( 'lead-start', request );
		this.#assertFree( request.npcId );
		const actor = this.#body( request.npcId, request.timeMin );
		if ( actor.place.kind === 'route' ) throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${request.npcId} cannot lead while aboard transit` );
		const target = request.target ? clone( request.target ) : null;
		const plan = this.#leadPlan( actor, request.destination, target );
		if ( ! plan ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${request.npcId} cannot reach the escort destination` );
		const { route, pending } = plan;
		this.#take( actor, request.timeMin );
		actor.mode = 'leading';
		actor.animation = route.distanceMeters > ARRIVAL_DISTANCE ? 'walk' : 'idle';
		this.follow = {
			npcId: actor.npcId, mode: 'leading', phase: 'walking', route, lastTimeMin: request.timeMin,
			destination: clone( request.destination ), pace: { ...( request.pace ?? LEAD_PACE ) },
			...( target ? { target } : {} ), ...( pending ? { pending: true } : {} )
		};
		return this.#actorOut( actor );

	}

	/**
	 * Sends one identity on an errand for the player, once their talk is done:
	 * it walks from where its body is to `target` (a world point, inside
	 * `target.parcelId` when given, through its door, stairs and lifts) and
	 * stays there until `untilMin`, seated with `target.seated`, facing
	 * `target.heading` or the player, then walks back into its day. The
	 * companion sent on an errand is the companion no more.
	 */
	sendOnErrand( request ) {

		this.boundary.input( 'errand-start', request );
		const { npcId, timeMin, target, untilMin } = request;
		if ( this.conversation?.npcId === npcId || this.pose?.npcId === npcId ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${npcId} is already under control` );

		}
		const actor = this.#body( npcId, timeMin );
		if ( actor.place.kind === 'route' ) throw new NpcContinuityError( 'E_NPC_PLACE', `NPC ${npcId} cannot set off while aboard transit` );
		const route = this.#plan( null, actor, { position: target.position, ...( target.parcelId ? { parcelId: target.parcelId } : {} ) }, ARRIVAL_DISTANCE );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${npcId} has no way to the errand's place` );
		const interrupted = this.follow?.npcId === npcId || this.holds.has( npcId ) || this.errands.has( npcId );
		if ( this.follow?.npcId === npcId ) this.follow = null;
		this.holds.delete( npcId );
		this.returns.delete( npcId );
		if ( ! interrupted ) this.#interrupt( npcId, timeMin );
		actor.visible = true;
		actor.mode = 'errand';
		actor.animation = route.distanceMeters > ARRIVAL_DISTANCE ? 'walk' : target.seated ? 'sit' : 'idle';
		this.actors.set( npcId, actor );
		this.errands.set( npcId, { npcId, route, target: clone( target ), untilMin } );
		return this.#actorOut( actor );

	}

	/** Ends an errand early: the identity walks back into its day from where it stands, after `linger` seconds. */
	endErrand( request ) {

		this.boundary.input( 'errand-stop', request );
		if ( ! this.errands.has( request.npcId ) ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${request.npcId} is on no errand` );
		return this.#finishErrand( this.actors.get( request.npcId ), request.timeMin, request.linger );

	}

	/** The identities on an errand now, each with its place, time and whether it has got there. */
	get errandsUnderway() {

		return [ ...this.errands.values() ].map( ( errand ) => ( {
			npcId: errand.npcId, untilMin: errand.untilMin, arrived: errand.route.distanceMeters - errand.route.cursor <= ARRIVAL_DISTANCE
		} ) );

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
		this.#assertFree();
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
		this.#clock( request );
		for ( const npcId of [ ...this.returns.keys() ].sort() ) this.#advanceReturn( this.actors.get( npcId ), request );
		for ( const npcId of [ ...this.errands.keys() ].sort() ) this.#advanceErrand( this.actors.get( npcId ), request );
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

	/**
	 * Lets the companion go: the simulation resumes and it walks back into its
	 * day from where it stands, after `linger` seconds turned to the player.
	 */
	stopFollow( request ) {

		this.boundary.input( 'follow-stop', request );
		if ( ! this.follow ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is following or leading' );
		if ( this.conversation?.npcId === this.follow.npcId ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'close the conversation before release' );
		const actor = this.actors.get( this.follow.npcId );
		this.#resume( actor.npcId, request.timeMin );
		this.follow = null;
		return this.#walkHome( actor, request.timeMin, request.linger );

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
		// A quest that wants a person on an errand takes them from it, as from a hold.
		const held = this.holds.has( npcId ) || this.errands.delete( npcId );
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

	/** Lets a held identity go: it walks from where it stands back into its day, after `linger` seconds turned to the player. */
	releaseHold( request ) {

		this.boundary.input( 'hold-release', request );
		if ( ! this.holds.has( request.npcId ) ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${request.npcId} is not held` );

		}
		const actor = this.actors.get( request.npcId );
		this.holds.delete( request.npcId );
		this.#resume( actor.npcId, request.timeMin );
		return this.#startResume( actor, request.timeMin, { keepPost: true, linger: request.linger } );

	}

	beginConversation( request ) {

		this.boundary.input( 'conversation-start', request );
		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is already in conversation` );
		if ( this.pose ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.pose.npcId} has an explicit pose` );
		// The companion and a person on an errand keep their control through a talk and go back to it after.
		const companion = this.follow?.npcId === request.npcId || this.errands.has( request.npcId );
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
		const record = this.follow?.npcId === request.npcId ? this.follow : this.errands.get( request.npcId );
		if ( record && distance( actor.position, request.position ) > ARRIVAL_DISTANCE ) {

			record.route = restingRoute( request.position, record.route.destination );

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
	 * @param request.linger seconds the body first stands there turned to the player
	 */
	endConversation( request ) {

		this.boundary.input( 'conversation-stop', request );
		if ( ! this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is in conversation' );
		const conversation = this.conversation;
		const actor = this.actors.get( conversation.npcId );
		this.conversation = null;
		if ( ! conversation.ownsInterruption ) {

			actor.mode = this.follow?.npcId === actor.npcId ? this.follow.mode : 'errand';
			actor.animation = actor.mode === 'errand' && this.errands.get( actor.npcId )?.target.seated && actor.animation === 'sit' ? 'sit' : 'idle';
			return this.#actorOut( actor );

		}
		if ( request.hold ) {

			actor.mode = 'posing';
			actor.animation = actor.animation === 'sit' ? 'sit' : 'idle';
			this.holds.set( actor.npcId, { npcId: actor.npcId, lastTimeMin: request.timeMin } );
			return this.#actorOut( actor );

		}
		this.#resume( actor.npcId, request.timeMin );
		return this.#startResume( actor, request.timeMin, { keepPost: true, linger: request.linger } );

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
			...( this.posts.size ? { posts: [ ...this.posts.values() ].sort( byId ).map( clone ) } : {} ),
			...( this.errands.size ? { errands: [ ...this.errands.values() ].sort( byId ).map( clone ) } : {} )
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
		if ( save.conversation && ! save.conversation.ownsInterruption && save.follow?.npcId !== save.conversation.npcId &&
			! ( save.errands ?? [] ).some( ( errand ) => errand.npcId === save.conversation.npcId ) ) {

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
			...save.returns.map( ( walk ) => [ 'return', walk ] ),
			...( save.errands ?? [] ).map( ( errand ) => [ 'errand', errand ] )
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
		for ( const errand of save.errands ?? [] ) interrupted.add( errand.npcId );
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
		this.errands = new Map( ( save.errands ?? [] ).map( ( errand ) => [ errand.npcId, clone( errand ) ] ) );
		this.events = [];
		return this.serialize();

	}

	/**
	 * Walks toward the player over the cached route, running when far, or with
	 * a pace that runs when the player runs, stopping short of them, or at the
	 * door of a building it has no way into. Standing, it faces the player.
	 */
	#advanceFollowing( actor, request ) {

		const follow = this.follow;
		const { route, door } = this.#followRoute( follow, actor, request );
		if ( ! route ) return this.#giveUp( actor, request.timeMin, 'unreachable' );
		follow.route = route;
		const remaining = route.distanceMeters - route.cursor;
		const toGo = Math.max( 0, remaining - ( door ? 0 : STOPPING_DISTANCE ) );
		const runs = follow.pace?.runs;
		const hurried = runs === true && this.player?.speed > PLAYER_RUNNING;
		const far = remaining > RUN_DISTANCE && runs !== false;
		const speed = toGo > EPSILON ? ( far || hurried ? RUN_SPEED : WALK_SPEED ) : 0;
		const moved = this.#walk( actor, route, Math.min( toGo, speed * request.deltaSeconds ) );
		if ( moved === 0 ) actor.heading = headingTo( actor.position, request.playerPosition, actor.heading );
		actor.animation = selectNpcAnimation( { speed: moved > 0 ? speed : 0 } );
		actor.mode = 'following';
		this.#phase( speed > 0 ? 'walking' : 'waiting', request.timeMin );

	}

	/**
	 * A follower's route: to the player, in through the door of the building
	 * the player stands in when interior routes find a way there; otherwise to
	 * that door when the player is upstairs or more than DOOR_REACH inside.
	 * @returns {{ route, door: boolean }} route null when there is no way at all
	 */
	#followRoute( record, actor, { playerPosition, playerPlace } ) {

		const player = { position: playerPosition };
		const door = playerPlace ? this.#door( playerPlace.id ) : null;
		if ( ! door ) return { route: this.#plan( record, actor, player, FOLLOW_REPLAN ), door: false };
		const miss = this.indoorMiss;
		const missed = miss?.parcelId === playerPlace.id && distance( miss.position, playerPosition ) <= INDOOR_RETRY;
		if ( this.interiorRoutes?.covers( playerPlace.id ) && ! missed ) {

			const route = this.#plan( record, actor, { position: playerPosition, parcelId: playerPlace.id }, FOLLOW_REPLAN, true );
			if ( route ) return { route, door: false };
			this.indoorMiss = { parcelId: playerPlace.id, position: [ ...playerPosition ] };

		}
		if ( playerPlace.floor === 0 && horizontal( playerPosition, door ) <= DOOR_REACH ) {

			return { route: this.#plan( record, actor, player, FOLLOW_REPLAN ), door: false };

		}
		return { route: this.#plan( record, actor, { position: door }, FOLLOW_REPLAN ), door: true };

	}

	/**
	 * Walks ahead of the player to the destination at the player's pace: full
	 * speed with the player close or ahead on the path (a jog when in a hurry,
	 * a run when the player runs and the pace runs), slower as the player lags,
	 * then stopped and facing them until they catch up. A lead into a building
	 * the interior routes could not walk yet goes on in once they can, from the
	 * doorstep; a lead to a person follows them as they move and stops a step
	 * short of them. Arrival is final: the leader stays where it stands, even
	 * where a conversation moved it, facing the player until released.
	 */
	#advanceLeading( actor, request ) {

		const lead = this.follow;
		const player = request.playerPosition;
		actor.mode = 'leading';
		if ( lead.phase === 'arrived' ) {

			actor.heading = headingTo( actor.position, lead.target?.npcId ? lead.target.position ?? player : player, actor.heading );
			actor.animation = 'idle';
			return;

		}
		let route;
		const person = lead.target?.npcId ? this.#personPoint( lead.target.npcId ) : null;
		if ( person ) {

			lead.target.position = person.position;
			route = this.#plan( lead, actor, { position: person.position, ...( person.parcelId ? { parcelId: person.parcelId } : {} ) }, PERSON_REPLAN );

		} else route = this.#plan( lead, actor, { position: lead.route.destination, ...( lead.route.parcelId ? { parcelId: lead.route.parcelId } : {} ) }, ARRIVAL_DISTANCE );
		if ( ! route ) return this.#giveUp( actor, request.timeMin, 'unreachable' );
		lead.route = route;
		const short = person ? PERSON_REACH : 0;
		const gap = distance( actor.position, player );
		const pace = lead.pace ?? LEAD_PACE;
		const close = pace.runs === true && this.player?.speed > PLAYER_RUNNING ? RUN_SPEED : pace.hurry ? JOG_SPEED : WALK_SPEED;
		let speed = 0;
		if ( gap <= LEAD_SLOW_FROM ) speed = close;
		else if ( playerAhead( route, player ) ) speed = gap > RUN_DISTANCE && pace.runs !== false ? RUN_SPEED : close;
		else if ( gap <= ( lead.phase === 'waiting' ? LEAD_RESUME_WITHIN : LEAD_WAIT_BEYOND ) ) {

			speed = WALK_SPEED - ( WALK_SPEED - SLOW_SPEED ) * Math.min( 1, ( gap - LEAD_SLOW_FROM ) / ( LEAD_WAIT_BEYOND - LEAD_SLOW_FROM ) );

		}
		const moved = this.#walk( actor, route, Math.min( Math.max( 0, route.distanceMeters - route.cursor - short ), speed * request.deltaSeconds ) );
		if ( route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE + short && ! route.ride ) {

			// Shown the building from its doorstep, a leader taking the player inside goes on in once the building can be walked.
			if ( lead.pending && this.#leadInside( lead, actor ) ) return;
			actor.heading = headingTo( actor.position, person ? person.position : player, actor.heading );
			actor.animation = 'idle';
			this.#phase( 'arrived', request.timeMin );
			return;

		}
		if ( moved === 0 ) actor.heading = headingTo( actor.position, player, actor.heading );
		actor.animation = selectNpcAnimation( { speed: moved > 0 ? speed : 0 } );
		this.#phase( speed > 0 ? 'walking' : 'waiting', request.timeMin );

	}

	/**
	 * A lead's first route: to a person where they are; into the building of
	 * a `target` inside one when the interior routes walk it now, else to its
	 * doorstep, `pending` the rest; else to the place's doorstep or position.
	 * @returns `{ route, pending? }` or null
	 */
	#leadPlan( actor, destination, target ) {

		if ( target?.npcId ) {

			const person = this.#personPoint( target.npcId );
			if ( ! person ) return null;
			target.position = person.position;
			const route = this.#plan( null, actor, { position: person.position, ...( person.parcelId ? { parcelId: person.parcelId } : {} ) }, PERSON_REPLAN );
			return route && { route };

		}
		const known = this.places.get( placeKey( destination ) );
		const doorstep = known?.doorstep ?? null;
		if ( target?.position ) {

			const goal = { position: target.position, ...( target.parcelId ? { parcelId: target.parcelId } : {} ) };
			const inside = target.parcelId ? this.#plan( null, actor, goal, ARRIVAL_DISTANCE, true ) : this.#plan( null, actor, goal, ARRIVAL_DISTANCE );
			if ( inside ) return { route: inside };
			if ( ! doorstep ) return null;
			const outside = this.#plan( null, actor, { position: doorstep }, ARRIVAL_DISTANCE );
			return outside && { route: outside, pending: true };

		}
		// A leader stops outside the entrance, where the player sees them arrive.
		const route = this.#plan( null, actor, { position: doorstep ?? this.#locatePlace( destination, null ).position }, ARRIVAL_DISTANCE );
		return route && { route };

	}

	/** Takes a lead waiting at the doorstep on into the building, when its interior routes walk there now. */
	#leadInside( lead, actor ) {

		const goal = { position: lead.target.position, parcelId: lead.target.parcelId };
		const route = this.interiorRoutes?.covers( lead.target.parcelId ) ? this.#plan( null, actor, goal, ARRIVAL_DISTANCE, true ) : null;
		if ( ! route ) return false;
		lead.route = route;
		delete lead.pending;
		return true;

	}

	/** Where a person is now: their body as continuity holds it, else their schedule's point; null when neither places them. */
	#personPoint( npcId ) {

		let actor = this.actors.get( npcId );
		if ( ! actor ) {

			try { actor = this.#scheduledActor( npcId, this.now ); }
			catch { return null; }

		}
		return { position: [ ...actor.position ], ...( actor.place.kind === 'parcel' ? { parcelId: actor.place.id } : {} ) };

	}

	#advanceReturn( actor, request ) {

		const walk = this.returns.get( actor.npcId );
		if ( walk.lingerUntilMin !== undefined ) {

			if ( request.timeMin < walk.lingerUntilMin ) return this.#linger( actor, request.playerPosition );
			delete walk.lingerUntilMin;

		}
		let scheduled;
		try { scheduled = this.#resumeTarget( actor, request.timeMin ); }
		catch { return this.#dropReturn( actor ); }
		if ( ! walk.route?.ride && distance( actor.position, scheduled.position ) <= ARRIVAL_DISTANCE ) return this.#finishResume( actor, scheduled );
		const route = this.#plan( walk, actor, scheduledGoal( scheduled ), RETURN_REPLAN );
		if ( ! route ) return this.#dropReturn( actor );
		walk.route = route;
		const moved = this.#walk( actor, route, Math.min( route.distanceMeters - route.cursor, WALK_SPEED * request.deltaSeconds ) );
		actor.animation = moved > 0 ? 'walk' : route.ride ? 'idle' : scheduled.animation;
		actor.schedule = scheduled.schedule;
		actor.mode = 'resuming';
		if ( ! route.ride && route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE && distance( route.destination, scheduled.position ) <= ARRIVAL_DISTANCE ) {

			this.#finishResume( actor, scheduled );

		}

	}

	/**
	 * An errand under way: the walk to its place, then the stay there, seated
	 * or standing facing its heading or the player, until its time is up and
	 * the body walks back into its day. A talk pauses it where the body stands.
	 */
	#advanceErrand( actor, request ) {

		const errand = this.errands.get( actor.npcId );
		if ( this.conversation?.npcId === actor.npcId ) return;
		if ( request.timeMin >= errand.untilMin ) return this.#finishErrand( actor, request.timeMin );
		const route = errand.route;
		actor.mode = 'errand';
		if ( route.distanceMeters - route.cursor > ARRIVAL_DISTANCE || route.ride ) {

			const moved = this.#walk( actor, route, Math.min( route.distanceMeters - route.cursor, WALK_SPEED * request.deltaSeconds ) );
			actor.animation = moved > 0 ? 'walk' : 'idle';
			return;

		}
		const { target } = errand;
		actor.position = [ ...target.position ];
		if ( target.parcelId ) actor.place = { kind: 'parcel', id: target.parcelId, ...( Number.isInteger( target.floor ) ? { floor: target.floor } : {} ) };
		actor.heading = target.heading ?? headingTo( actor.position, request.playerPosition, actor.heading );
		actor.animation = target.seated ? 'sit' : 'idle';

	}

	/** Ends an errand: the simulation resumes and the body walks back into its day from where it stands. */
	#finishErrand( actor, timeMin, linger = 0 ) {

		this.errands.delete( actor.npcId );
		try { this.simulation.resume( actor.npcId, timeMin ); } catch {}
		return this.#walkHome( actor, timeMin, linger );

	}

	/**
	 * When a visible body's schedule has moved it more than JUMP, from one
	 * anchor to another or in or out of a building, it walks there instead, as
	 * a walk home of its own through doors, stairs and lifts. False when the
	 * way there is a step or there is none, and the schedule takes the body.
	 */
	#walkOver( actor, scheduled ) {

		if ( distance( actor.position, scheduled.position ) <= JUMP ) return false;
		let route = null;
		try { route = this.#plan( null, actor, scheduledGoal( scheduled ), RETURN_REPLAN ); }
		catch { route = null; }
		if ( ! route || route.distanceMeters <= JUMP ) return false;
		actor.mode = 'resuming';
		actor.animation = 'walk';
		actor.schedule = scheduled.schedule;
		this.returns.set( actor.npcId, { npcId: actor.npcId, route } );
		return true;

	}

	/** A body let go beside the player stands where it is, turned to them unless it sits. */
	#linger( actor, playerPosition ) {

		actor.mode = 'resuming';
		if ( actor.animation === 'sit' ) return;
		actor.animation = 'idle';
		actor.heading = headingTo( actor.position, playerPosition, actor.heading );

	}

	#dropReturn( actor ) {

		this.returns.delete( actor.npcId );
		actor.mode = 'released';
		actor.animation = 'idle';

	}

	/** The clock and frame of this update, and how fast the player has been moving. */
	#clock( request ) {

		const dt = request.deltaSeconds;
		const last = this.player;
		const raw = last && dt > 0 ? horizontal( last.position, request.playerPosition ) / dt : 0;
		// A teleport is no run: what a frame could not walk does not count.
		const step = raw > 12 ? last?.speed ?? 0 : raw;
		this.player = { position: [ ...request.playerPosition ], speed: last ? last.speed + ( step - last.speed ) * Math.min( 1, dt * 4 ) : 0 };
		this.now = request.timeMin;
		this.delta = dt;

	}

	/**
	 * The record's cached route to `goal`, or a new one planned from the body
	 * when the goal has moved past `replanBeyond`, changed building, or the
	 * route has run out short of it. `record` null plans a first route. A
	 * route under way in a lift is kept until the walker is out of it.
	 * @param goal `{ position, parcelId? }`, parcelId the building it stands in
	 * @param strict null instead of a way that does not go inside that building
	 */
	#plan( record, actor, goal, replanBeyond, strict = false ) {

		const route = record?.route;
		if ( route?.ride ) return route;
		if ( route && ( route.parcelId ?? null ) === ( goal.parcelId ?? null ) &&
			distance( route.destination, goal.position ) <= replanBeyond &&
			! ( route.distanceMeters - route.cursor <= ARRIVAL_DISTANCE && distance( actor.position, goal.position ) > ARRIVAL_DISTANCE ) ) {

			return route;

		}
		const planned = this.#route( actor, goal, strict );
		return planned ? savedRoute( planned, goal ) : null;

	}

	/**
	 * A walk over Connections path3 from the body to a goal, through the main
	 * door of every building it leaves or enters: from inside a building to
	 * its door, out over the doorstep to the pavement, and in again over the
	 * goal building's doorstep through its door, each crossing a door gate.
	 * Inside a building the interior routes walk it (stairs, lifts, apartment
	 * doors); one they do not cover is crossed straight from its door, and,
	 * `strict`, a goal they cannot reach inside its building has no way.
	 */
	#route( actor, goal, strict ) {

		const from = actor.position;
		const exitId = actor.place.kind === 'parcel' ? actor.place.id : null;
		const entryId = goal.parcelId ?? null;
		if ( exitId && exitId === entryId ) {

			// Within one building its own navigation walks a body. A building the
			// interior routes do not cover now is one out of the player's sight,
			// whose body the street walk carries over as before.
			const inside = this.#indoor( exitId, from, goal.position );
			if ( inside ) return joinLegs( [ { ...inside, parcelId: exitId } ] );
			return strict || this.interiorRoutes?.covers( exitId ) ? null : this.routes.route( from, goal.position );

		}
		const legs = [];
		let start = from;
		const exit = exitId ? this.#doorway( exitId ) : null;
		if ( exit ) {

			const inside = this.interiorRoutes?.covers( exitId ) ? this.#indoor( exitId, from, exit.inside ) : null;
			legs.push( { ...( inside ?? { path3: [ [ ...from ], [ ...exit.inside ] ] } ), parcelId: exitId } );
			legs.push( { path3: [ [ ...exit.inside ], [ ...exit.outside ] ], parcelId: exitId, gates: doorGate( exitId, exit, exit.inside ) } );
			start = exit.outside;

		}
		let end = goal.position;
		const entering = [];
		const entry = entryId ? this.#doorway( entryId ) : null;
		if ( entry ) {

			const inside = this.interiorRoutes?.covers( entryId ) ? this.#indoor( entryId, entry.inside, goal.position ) : null;
			if ( strict && ! inside ) return null;
			entering.push( { path3: [ [ ...entry.outside ], [ ...entry.inside ] ], parcelId: entryId, gates: doorGate( entryId, entry, entry.outside ) } );
			entering.push( { ...( inside ?? { path3: [ [ ...entry.inside ], [ ...goal.position ] ] } ), parcelId: entryId } );
			end = entry.outside;

		} else if ( strict && entryId ) return null;
		const outdoor = this.routes.route( start, end );
		if ( ! outdoor ) return null;
		return joinLegs( [ ...legs, { path3: outdoor.path3 }, ...entering ] );

	}

	/** A walk inside one building from the interior routes, `{ path3, gates? }`, or null. */
	#indoor( parcelId, from, to ) {

		if ( ! from || ! to || ! this.interiorRoutes ) return null;
		return this.boundary.input( 'interior-route', this.interiorRoutes.route( parcelId, [ ...from ], [ ...to ] ) ?? null );

	}

	/** The point just inside a parcel's door, where its interior meets the street. */
	#door( parcelId ) {

		return this.places.get( `parcel:${parcelId}` )?.position ?? null;

	}

	/** A building's main door as a walker crosses it: just inside, and the doorstep just outside (the same point where none is known); null for an unknown place. */
	#doorway( parcelId ) {

		const place = this.places.get( `parcel:${parcelId}` );
		return place?.position ? { inside: place.position, outside: place.doorstep ?? place.position } : null;

	}

	/**
	 * Moves the body up to `travel` metres on along its cached route, inside a
	 * building while the route is, on the floor its anchor or stretch names;
	 * stopping short of a door until it opens and riding a lift through its
	 * gate. Returns the metres it moved.
	 */
	#walk( actor, route, travel ) {

		const allowed = this.#gates( actor, route, travel );
		if ( ! ( allowed > 0 ) ) return 0;
		const before = route.cursor;
		route.cursor = Math.min( route.distanceMeters, route.cursor + allowed );
		const moved = pointAtDistance( route.path3, route.cursor );
		actor.position = moved.position;
		actor.heading = moved.heading ?? actor.heading;
		const inside = route.indoor?.find( ( stretch ) => route.cursor >= stretch.from - EPSILON && route.cursor <= stretch.to + EPSILON );
		if ( inside ) actor.place = { kind: 'parcel', id: inside.parcelId };
		else this.#putOnWalkGraph( actor );
		return route.cursor - before;

	}

	/**
	 * What the gates ahead allow of `travel` metres: a lift under way holds the
	 * body in its car (placed at the car's height, 0 returned) and walks it in
	 * and out at a walk whatever the walker's pace; a lift landing reached
	 * calls the car and stands there until it opens; a door within DOOR_LOOK
	 * is asked open and stood short of until it is. With no `ways`, or a way
	 * that runs no such door or lift, the route is walked as drawn.
	 */
	#gates( actor, route, travel ) {

		const gates = route.gates;
		if ( ! gates?.length || ! this.ways ) return travel;
		const ride = route.ride;
		if ( ride ) {

			const gate = gates[ ride.gate ];
			const walking = Math.max( travel, WALK_SPEED * this.delta );
			if ( ride.stage === 'call' ) {

				const answer = this.ways.ride( actor.npcId, gate, 'call' );
				if ( answer === null ) {

					delete route.ride;
					return travel;

				}
				if ( answer !== 'board' && this.now - ride.sinceMin < LIFT_PATIENCE_MIN ) return 0;
				ride.stage = 'board';

			}
			if ( ride.stage === 'board' ) {

				if ( route.cursor + walking < gate.board ) return walking;
				ride.stage = 'ride';
				ride.sinceMin = this.now;
				this.ways.ride( actor.npcId, gate, 'ride' );
				return gate.board - route.cursor;

			}
			if ( ride.stage === 'ride' ) {

				const answer = this.ways.ride( actor.npcId, gate, 'ride' );
				if ( answer && answer !== 'alight' && this.now - ride.sinceMin < LIFT_PATIENCE_MIN ) {

					const car = pointAtDistance( route.path3, gate.board ).position;
					actor.position = [ car[ 0 ], answer.y, car[ 2 ] ];
					return 0;

				}
				// Out of the car where the shaft lets the walker out.
				route.cursor = gate.alight;
				ride.stage = 'alight';

			}
			if ( route.cursor + walking >= gate.to ) {

				delete route.ride;
				this.ways.ride( actor.npcId, gate, 'done' );

			}
			return walking;

		}
		const lift = gates.findIndex( ( gate ) => gate.kind === 'lift' && route.cursor < gate.board - EPSILON && route.cursor + travel >= gate.from - EPSILON );
		if ( lift >= 0 && this.ways.ride( actor.npcId, gates[ lift ], 'call' ) !== null ) {

			route.ride = { gate: lift, stage: 'call', sinceMin: this.now };
			return Math.max( 0, gates[ lift ].from - route.cursor );

		}
		for ( const gate of gates ) {

			if ( gate.kind !== 'door' || gate.at < route.cursor - EPSILON || gate.at - route.cursor > DOOR_LOOK ) continue;
			if ( ! this.ways.pass( actor.npcId, gate ) ) travel = Math.min( travel, Math.max( 0, gate.at - DOOR_SHORT - route.cursor ) );

		}
		return travel;

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
	#walkHome( actor, timeMin, linger = 0 ) {

		try { return this.#startResume( actor, timeMin, { linger } ); }
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
	 * With `linger` the body first stands where it is for that many seconds,
	 * turned to the player, as a walk home that has not set off yet.
	 * @param options.keepPost keeps a parcel body at its post when no way home exists
	 * @param options.linger seconds to stand before walking
	 */
	#startResume( actor, timeMin, { keepPost = false, linger = 0 } = {} ) {

		const keep = keepPost && actor.place.kind === 'parcel';
		let scheduled;
		try { scheduled = this.#resumeTarget( actor, timeMin ); }
		catch ( error ) {

			if ( keep ) return this.#keepUnroutablePost( actor, timeMin );
			throw error;

		}
		// A worker or seated visitor let go at their post, or a cast member
		// posted where their rota has them, is already back in their day: a
		// way over the street graph would lead out through a wall and back.
		const route = distance( actor.position, scheduled.position ) <= ARRIVAL_DISTANCE
			? restingRoute( actor.position, scheduled.position )
			: this.#plan( null, actor, scheduledGoal( scheduled ), RETURN_REPLAN );
		if ( ! route ) {

			if ( keep ) return this.#keepUnroutablePost( actor, timeMin );
			throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${actor.npcId} cannot resume its schedule` );

		}
		if ( ! ( linger > 0 ) && route.distanceMeters <= ARRIVAL_DISTANCE ) {

			this.#finishResume( actor, scheduled );
			return this.#actorOut( actor );

		}
		actor.mode = 'resuming';
		actor.animation = ! ( linger > 0 ) ? 'walk' : actor.animation === 'sit' ? 'sit' : 'idle';
		actor.schedule = scheduled.schedule;
		this.returns.set( actor.npcId, { npcId: actor.npcId, route, ...( linger > 0 ? { lingerUntilMin: timeMin + linger / 60 } : {} ) } );
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

	/**
	 * Takes a body under control: a held one and the companion changing mode
	 * keep their interruption, anybody else is interrupted now.
	 */
	#take( actor, timeMin ) {

		const held = this.holds.delete( actor.npcId ) || this.errands.delete( actor.npcId );
		if ( ! held && this.follow?.npcId !== actor.npcId ) this.#interrupt( actor.npcId, timeMin );
		this.returns.delete( actor.npcId );
		actor.visible = true;
		this.actors.set( actor.npcId, actor );

	}

	/** Nothing else controls anybody: no conversation, pose, or companion other than `npcId`. */
	#assertFree( npcId = null ) {

		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is in conversation` );
		if ( this.follow && this.follow.npcId !== npcId ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.follow.npcId} is already ${this.follow.mode}` );
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
		const { floor, ...located } = this.#locatePlace( state.behavior.place, state.behavior.interior );
		return { place: { ...clone( state.behavior.place ), ...( Number.isInteger( floor ) ? { floor } : {} ) }, ...located };

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
		// At an anchor, or walking to one: the body is placed where the step has it, on that anchor's floor.
		const anchorId = interior && ( 'at' in interior ? interior.at.anchorId : interior.walk.toAnchorId );
		const anchor = anchorId ? known?.anchors?.find( ( candidate ) => candidate.id === anchorId ) : null;
		if ( anchor ) return { position: [ ...anchor.position ], heading: anchor.heading ?? 0, ...( Number.isInteger( anchor.floor ) ? { floor: anchor.floor } : {} ) };
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

/** A planned walk as the save keeps it: its path, how far along it the body is, and the goal it was planned to. */
function savedRoute( route, goal ) {

	return {
		path3: route.path3.map( ( point ) => [ ...point ] ),
		distanceMeters: route.distanceMeters,
		cursor: 0,
		destination: [ ...goal.position ],
		...( goal.parcelId ? { parcelId: goal.parcelId } : {} ),
		...( route.indoor?.length ? { indoor: route.indoor.map( ( stretch ) => ( { ...stretch } ) ) } : {} ),
		...( route.gates?.length ? { gates: route.gates.map( ( gate ) => shiftGate( gate, 0 ) ) } : {} )
	};

}

/**
 * Legs joined into one walk, with the stretches walked inside a building and
 * each leg's gates (measured from the leg's first point) measured along it.
 */
function joinLegs( legs ) {

	const path3 = [];
	const indoor = [];
	const gates = [];
	for ( const leg of legs ) {

		const from = pathDistance( path3 );
		const gap = path3.length && leg.path3.length ? distance( path3.at( - 1 ), leg.path3[ 0 ] ) : 0;
		const offset = from + ( gap > 1e-9 ? gap : 0 );
		for ( const point of leg.path3 ) if ( ! path3.length || distance( path3.at( - 1 ), point ) > 1e-9 ) path3.push( [ ...point ] );
		const last = indoor.at( - 1 );
		if ( leg.parcelId && last?.parcelId === leg.parcelId && Math.abs( last.to - from ) < 1e-6 ) last.to = pathDistance( path3 );
		else if ( leg.parcelId ) indoor.push( { parcelId: leg.parcelId, from, to: pathDistance( path3 ) } );
		for ( const gate of leg.gates ?? [] ) gates.push( shiftGate( gate, offset ) );

	}
	return { path3, distanceMeters: pathDistance( path3 ), indoor, ...( gates.length ? { gates } : {} ) };

}

/** A gate measured `offset` metres further along. */
function shiftGate( gate, offset ) {

	if ( gate.kind === 'door' ) return { ...gate, at: gate.at + offset, position: [ ...gate.position ] };
	return { ...gate, from: gate.from + offset, board: gate.board + offset, alight: gate.alight + offset, to: gate.to + offset };

}

/** The main door of a building as the gates on the way through it, from `start` (inside or outside): none where inside and out are one point. */
function doorGate( parcelId, door, start ) {

	if ( distance( door.inside, door.outside ) <= ARRIVAL_DISTANCE ) return [];
	const middle = lerp( door.inside, door.outside, 0.5 );
	return [ { kind: 'door', parcelId, floor: 0, at: distance( start, middle ), position: middle } ];

}

/** Where a walk home goes: its scheduled point, inside the building it is scheduled in. */
function scheduledGoal( scheduled ) {

	return { position: scheduled.position, ...( scheduled.place.kind === 'parcel' ? { parcelId: scheduled.place.id } : {} ) };

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
function horizontal( a, b ) { return Math.hypot( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] ); }
function clone( value ) { return structuredClone( value ); }
function messageOf( error ) { return error instanceof Error ? error.message : String( error ); }
