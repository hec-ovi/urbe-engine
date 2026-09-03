import { NpcContinuityBoundary } from './NpcContinuityBoundary.js';
import { NpcContinuityError } from './NpcContinuityError.js';

const WALK_SPEED = 1.4;
const RUN_SPEED = 2.4;
const RUN_DISTANCE = 8;
const STOPPING_DISTANCE = 1.8;
const ARRIVAL_DISTANCE = 0.08;

/**
 * Persistent materialization and quest-follow control for actual simulation
 * NPC ids. It owns no population or schedule data: every scheduled state is
 * projected from the simulation, and every moving point is sampled from the
 * Connections walk graph supplied through WalkRoutes.
 */
export class NpcContinuity {

	constructor( { simulation, routes, places = [], boundary = new NpcContinuityBoundary() } ) {

		this.simulation = simulation;
		this.routes = routes;
		this.boundary = boundary;
		this.boundary.input( 'movement-network', routes.networks );
		this.places = new Map( this.boundary.input( 'places', places ).map( ( place ) => [ placeKey( place ), place ] ) );
		this.actors = new Map();
		this.follow = null;
		this.conversation = null;

	}

	/** Materializes one exact identity at its current scheduled point. */
	appear( request ) {

		this.boundary.input( 'appearance-request', request );
		const { npcId, timeMin } = request;
		if ( this.follow?.npcId === npcId || this.conversation?.npcId === npcId ) {

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
		if ( this.follow?.npcId === npcId || this.conversation?.npcId === npcId ) {

			throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${npcId} is under active control` );

		}
		const actor = this.actors.get( npcId );
		if ( actor ) actor.visible = false;
		return this.#actorMaybeOut( actor ?? null );

	}

	/** Reprojects every visible materialization and virtualizes distant schedule-controlled bodies. */
	updateVisible( request ) {

		this.boundary.input( 'visible-update', request );
		const controlled = new Set( [ this.follow?.npcId, this.conversation?.npcId ].filter( Boolean ) );
		const states = [];
		for ( const [ npcId, actor ] of [ ...this.actors.entries() ].sort( ( a, b ) => a[ 0 ].localeCompare( b[ 0 ] ) ) ) {

			if ( ! actor.visible ) {

				states.push( clone( actor ) );
				continue;

			}
			if ( controlled.has( npcId ) ) {

				states.push( clone( actor ) );
				continue;

			}
			if ( distance( actor.position, request.playerPosition ) > request.maxDistance ) {

				actor.visible = false;
				states.push( clone( actor ) );
				continue;

			}
			try {

				const scheduled = this.#scheduledActor( npcId, request.timeMin );
				scheduled.visible = true;
				this.actors.set( npcId, scheduled );
				states.push( clone( scheduled ) );

			} catch {

				actor.visible = false;
				states.push( clone( actor ) );

			}

		}
		return this.boundary.output( 'actor-states', states );

	}

	startFollow( request ) {

		this.boundary.input( 'follow-start', request );
		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is in conversation` );
		if ( this.follow ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.follow.npcId} is already following` );
		const actor = this.#scheduledActor( request.npcId, request.timeMin );
		const route = this.routes.route( actor.position, request.playerPosition );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${request.npcId} cannot reach the player` );
		this.#interrupt( request.npcId, request.timeMin );
		actor.visible = true;
		actor.mode = 'following';
		actor.animation = route.distanceMeters > STOPPING_DISTANCE ? 'walk' : 'idle';
		this.actors.set( actor.npcId, actor );
		this.follow = {
			npcId: actor.npcId,
			mode: 'following',
			source: 'follow',
			route: savedRoute( route, request.playerPosition, 0 ),
			lastTimeMin: request.timeMin
		};
		return this.#actorOut( actor );

	}

	updateFollow( request ) {

		this.boundary.input( 'follow-update', request );
		if ( ! this.follow ) return this.#actorMaybeOut( null );
		const actor = this.actors.get( this.follow.npcId );
		if ( ! actor ) return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', 'followed NPC state is unavailable', request.timeMin );
		if ( this.conversation?.npcId === actor.npcId ) {

			actor.mode = 'conversation';
			actor.animation = 'idle';
			this.follow.lastTimeMin = request.timeMin;
			return this.#actorOut( actor );

		}
		try {

			const npc = this.simulation.getNPC( actor.npcId );
			if ( npc.flags?.dead ) return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', `NPC ${actor.npcId} is dead`, request.timeMin );

		} catch ( error ) {

			return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', messageOf( error ), request.timeMin );

		}

		if ( this.follow.mode === 'following' ) this.#advanceFollowing( actor, request );
		else this.#advanceResume( actor, request );
		if ( this.follow ) this.follow.lastTimeMin = request.timeMin;
		return this.#actorOut( actor );

	}

	stopFollow( request ) {

		this.boundary.input( 'follow-stop', request );
		if ( ! this.follow ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is following' );
		if ( this.follow.mode !== 'following' ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'NPC is already returning to its schedule' );
		if ( this.conversation?.npcId === this.follow.npcId ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'close the conversation before release' );
		const actor = this.actors.get( this.follow.npcId );
		if ( ! actor ) return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', 'followed NPC state is unavailable', request.timeMin );
		this.#resume( this.follow.npcId, request.timeMin );
		let scheduled;
		try {

			scheduled = this.#scheduledActor( actor.npcId, request.timeMin );

		} catch ( error ) {

			if ( error?.code !== 'E_NPC_PLACE' ) throw error;
			try { scheduled = this.#destinationActor( actor, request.timeMin ); }
			catch ( destinationError ) {

				return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', messageOf( destinationError ), request.timeMin );

			}

		}
		const route = this.routes.route( actor.position, scheduled.position );
		if ( ! route ) return this.#releaseInvalid( 'E_NPC_PATH', `NPC ${actor.npcId} cannot resume its schedule`, request.timeMin );
		actor.mode = 'resuming';
		actor.animation = route.distanceMeters > ARRIVAL_DISTANCE ? 'walk' : scheduled.animation;
		actor.schedule = scheduled.schedule;
		this.follow = {
			npcId: actor.npcId,
			mode: 'resuming',
			source: 'follow',
			route: savedRoute( route, scheduled.position, 0 ),
			lastTimeMin: request.timeMin
		};
		if ( route.distanceMeters <= ARRIVAL_DISTANCE ) this.#finishResume( actor, scheduled );
		return this.#actorOut( actor );

	}

	beginConversation( request ) {

		this.boundary.input( 'conversation-start', request );
		if ( this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', `NPC ${this.conversation.npcId} is already in conversation` );
		if ( this.follow?.mode === 'resuming' && this.follow.npcId === request.npcId ) this.follow = null;
		const following = this.follow?.mode === 'following' && this.follow.npcId === request.npcId;
		const actor = following ? this.actors.get( request.npcId ) : this.#scheduledActor( request.npcId, request.timeMin );
		if ( ! actor ) throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', `NPC ${request.npcId} has no materialized actor` );
		if ( ! following ) this.#interrupt( request.npcId, request.timeMin );
		actor.position = [ ...request.position ];
		actor.heading = request.heading;
		actor.place = clone( request.place );
		actor.visible = true;
		actor.mode = 'conversation';
		actor.animation = request.seated ? 'sit' : 'idle';
		this.actors.set( actor.npcId, actor );
		this.conversation = {
			npcId: actor.npcId,
			ownsInterruption: ! following,
			lastTimeMin: request.timeMin
		};
		return this.#actorOut( actor );

	}

	endConversation( request ) {

		this.boundary.input( 'conversation-stop', request );
		if ( ! this.conversation ) throw new NpcContinuityError( 'E_NPC_CONFLICT', 'no NPC is in conversation' );
		const conversation = this.conversation;
		const actor = this.actors.get( conversation.npcId );
		this.conversation = null;
		if ( ! actor ) throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', `NPC ${conversation.npcId} has no materialized actor` );
		if ( ! conversation.ownsInterruption ) {

			actor.mode = 'following';
			actor.animation = 'idle';
			return this.#actorOut( actor );

		}
		this.#resume( actor.npcId, request.timeMin );
		return this.#startResume( actor, request.timeMin, 'conversation' );

	}

	serialize() {

		return this.boundary.output( 'continuity-save', {
			version: '1',
			actors: [ ...this.actors.values() ].sort( ( a, b ) => a.npcId.localeCompare( b.npcId ) ).map( clone ),
			follow: this.follow ? clone( this.follow ) : null,
			conversation: this.conversation ? clone( this.conversation ) : null
		} );

	}

	restore( save ) {

		this.boundary.input( 'continuity-save', save );
		const ids = new Set();
		for ( const actor of save.actors ) {

			if ( ids.has( actor.npcId ) ) throw new NpcContinuityError( 'E_NPC_INPUT', `duplicate actor ${actor.npcId}` );
			ids.add( actor.npcId );
			let npc;
			try { npc = this.simulation.getNPC( actor.npcId ); }
			catch { throw new NpcContinuityError( 'E_NPC_INPUT', `save actor ${actor.npcId} is not present in the restored simulation` ); }
			if ( ( save.follow?.npcId === actor.npcId || save.conversation?.npcId === actor.npcId ) && npc.flags?.dead ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `controlled save actor ${actor.npcId} is dead` );

			}
			if ( npc.appearanceSeed !== actor.appearanceSeed || npc.gender !== actor.gender || npc.type !== actor.type ||
				npc.name.given !== actor.name.given || npc.name.family !== actor.name.family ) {

				throw new NpcContinuityError( 'E_NPC_INPUT', `save actor ${actor.npcId} does not match its simulation identity` );

			}

		}
		if ( save.follow && ! ids.has( save.follow.npcId ) ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', `follow state references missing actor ${save.follow.npcId}` );

		}
		if ( save.conversation && ! ids.has( save.conversation.npcId ) ) {

			throw new NpcContinuityError( 'E_NPC_INPUT', `conversation state references missing actor ${save.conversation.npcId}` );

		}
		this.actors = new Map( save.actors.map( ( actor ) => [ actor.npcId, clone( actor ) ] ) );
		this.follow = save.follow ? clone( save.follow ) : null;
		this.conversation = save.conversation ? clone( save.conversation ) : null;
		if ( this.follow ) this.#interrupt( this.follow.npcId, this.follow.lastTimeMin );
		if ( this.conversation?.ownsInterruption && this.conversation.npcId !== this.follow?.npcId ) {

			this.#interrupt( this.conversation.npcId, this.conversation.lastTimeMin );

		}
		return this.serialize();

	}

	#advanceFollowing( actor, request ) {

		const route = this.routes.route( actor.position, request.playerPosition );
		if ( ! route ) return this.#releaseInvalid( 'E_NPC_PATH', `NPC ${actor.npcId} cannot reach the player`, request.timeMin );
		const remaining = Math.max( 0, route.distanceMeters - STOPPING_DISTANCE );
		const speed = route.distanceMeters > RUN_DISTANCE ? RUN_SPEED : remaining > 0 ? WALK_SPEED : 0;
		const travel = Math.min( remaining, speed * request.deltaSeconds );
		const moved = pointAtDistance( route.path3, travel );
		actor.position = moved.position;
		actor.heading = moved.heading ?? actor.heading;
		actor.animation = selectNpcAnimation( { speed } );
		actor.mode = 'following';
		this.#putOnWalkGraph( actor );
		this.follow.route = savedRoute( route, request.playerPosition, travel );

	}

	#advanceResume( actor, request ) {

		let scheduled;
		try {

			scheduled = this.#scheduledActor( actor.npcId, request.timeMin );

		} catch ( error ) {

			if ( error?.code !== 'E_NPC_PLACE' ) return this.#releaseInvalid( 'E_NPC_UNAVAILABLE', messageOf( error ), request.timeMin );
			scheduled = this.#destinationActor( actor, request.timeMin );

		}
		const route = this.routes.route( actor.position, scheduled.position );
		if ( ! route ) return this.#releaseInvalid( 'E_NPC_PATH', `NPC ${actor.npcId} cannot resume its schedule`, request.timeMin );
		const travel = Math.min( route.distanceMeters, WALK_SPEED * request.deltaSeconds );
		const moved = pointAtDistance( route.path3, travel );
		actor.position = moved.position;
		actor.heading = moved.heading ?? actor.heading;
		actor.animation = travel > 0 ? 'walk' : scheduled.animation;
		actor.schedule = scheduled.schedule;
		actor.mode = 'resuming';
		this.#putOnWalkGraph( actor );
		this.follow.route = savedRoute( route, scheduled.position, travel );
		if ( route.distanceMeters - travel <= ARRIVAL_DISTANCE ) this.#finishResume( actor, scheduled );

	}

	#startResume( actor, timeMin, source ) {

		let scheduled;
		try {

			scheduled = this.#scheduledActor( actor.npcId, timeMin );

		} catch ( error ) {

			if ( error?.code !== 'E_NPC_PLACE' ) throw error;
			scheduled = this.#destinationActor( actor, timeMin );

		}
		const route = this.routes.route( actor.position, scheduled.position );
		if ( ! route ) throw new NpcContinuityError( 'E_NPC_PATH', `NPC ${actor.npcId} cannot resume its schedule` );
		actor.mode = 'resuming';
		actor.animation = route.distanceMeters > ARRIVAL_DISTANCE ? 'walk' : scheduled.animation;
		actor.schedule = scheduled.schedule;
		this.follow = {
			npcId: actor.npcId,
			mode: 'resuming',
			source,
			route: savedRoute( route, scheduled.position, 0 ),
			lastTimeMin: timeMin
		};
		if ( route.distanceMeters <= ARRIVAL_DISTANCE ) this.#finishResume( actor, scheduled );
		return this.#actorOut( actor );

	}

	#finishResume( actor, scheduled ) {

		const visible = actor.visible;
		Object.assign( actor, scheduled, { visible, mode: 'schedule' } );
		this.follow = null;

	}

	#scheduledActor( npcId, timeMin ) {

		let npc;
		let state;
		try {

			npc = this.simulation.getNPC( npcId );
			if ( npc.flags?.dead ) throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', `NPC ${npcId} is dead` );
			state = this.simulation.continuityAt( npcId, timeMin );

		} catch ( error ) {

			if ( error instanceof NpcContinuityError ) throw error;
			throw new NpcContinuityError(
				error?.code === 'E_UNKNOWN_ID' ? 'E_NPC_UNKNOWN' : 'E_NPC_UNAVAILABLE',
				messageOf( error )
			);

		}
		const located = this.#locate( state );
		return {
			npcId: npc.npcId,
			name: clone( npc.name ),
			gender: npc.gender,
			type: npc.type,
			appearanceSeed: npc.appearanceSeed,
			place: located.place,
			position: located.position,
			heading: located.heading,
			animation: state.animation,
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

	#locate( state ) {

		if ( state.movement ) {

			const current = state.movement.current;
			const edge = this.routes.edges.get( current.edgeId );
			if ( ! edge ) throw new NpcContinuityError( 'E_NPC_PLACE', `scheduled edge ${current.edgeId} is unavailable` );
			const point = this.routes.pointAt( edge, edge.length * current.progress, 1 );
			return { place: { kind: 'edge', id: edge.id }, position: [ point.x, point.y, point.z ], heading: point.heading };

		}
		return { place: clone( state.behavior.place ), ...this.#locatePlace( state.behavior.place, state.behavior.interior ) };

	}

	#locatePlace( place, interior ) {

		if ( place.kind === 'route' ) throw new NpcContinuityError( 'E_NPC_PLACE', `route ${place.id} has no walk position` );
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

	#interrupt( npcId, timeMin ) {

		try { this.simulation.interrupt( npcId, timeMin ); }
		catch ( error ) { throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', messageOf( error ) ); }

	}

	#resume( npcId, timeMin ) {

		try { this.simulation.resume( npcId, timeMin ); }
		catch ( error ) { throw new NpcContinuityError( 'E_NPC_UNAVAILABLE', messageOf( error ) ); }

	}

	#releaseInvalid( code, message, timeMin ) {

		if ( ! this.follow ) throw new NpcContinuityError( code, message );
		const actor = this.actors.get( this.follow.npcId );
		try { this.simulation.resume( this.follow.npcId, timeMin ?? this.follow.lastTimeMin ); } catch {}
		this.follow = null;
		if ( actor ) {

			actor.mode = 'released';
			actor.animation = 'idle';

		}
		return this.#actorMaybeOut( actor ?? null );

	}

	#actorOut( actor ) {

		return this.boundary.output( 'actor-state', clone( actor ) );

	}

	#actorMaybeOut( actor ) {

		return this.boundary.output( 'actor-state-or-null', actor ? clone( actor ) : null );

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
			return {
				position: [
					a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t,
					a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t,
					a[ 2 ] + ( b[ 2 ] - a[ 2 ] ) * t
				],
				heading: Math.atan2( b[ 0 ] - a[ 0 ], b[ 2 ] - a[ 2 ] )
			};

		}
		remaining -= span;

	}
	return { position: [ ...path.at( - 1 ) ], heading: null };

}

function savedRoute( route, destination, cursor ) {

	return {
		path3: route.path3.map( ( point ) => [ ...point ] ),
		distanceMeters: route.distanceMeters,
		cursor,
		destination: [ ...destination ]
	};

}

function placeKey( place ) { return `${place.kind}:${place.id}`; }
function distance( a, b ) { return Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ], b[ 2 ] - a[ 2 ] ); }
function clone( value ) { return structuredClone( value ); }
function messageOf( error ) { return error instanceof Error ? error.message : String( error ); }
