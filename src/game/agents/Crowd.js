import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { CLIP, bodyFor, clipForNpcAnimation } from './CharacterAssets.js';
import { FRAMES } from './VatBaker.js';
import { look } from './Appearance.js';

const WALK_SPEED = 1.4;
const SPAWN_RADIUS = 90;
const DESPAWN_RADIUS = 115;
/** How far off somebody the simulation no longer reports may leave the world:
 *  far enough back that nobody is ever seen going out. */
const RETIRE_RADIUS = 60;
const REFRESH_INTERVAL = 3;
const PARCEL_RADIUS = 45;
/** People the simulation may report on one sidewalk edge. A 40 m edge never
 *  holds more than a handful, and the cap is per edge, not per city. */
const EDGE_AGENTS = 16;
const PARCEL_AGENTS = 8;
/** The space one person stands in, measured for the pushback only. */
const PERSON_RADIUS = 0.34;
/** Above or below this, the two are on different floors and never touch. */
const PERSON_HEIGHT = 2;
/** How far around a walker talk looks for the street they belong to. */
const STREET_REACH = 25;

/**
 * The people in the world, all of them real. Two sources, both the simulation
 * library's own (../simulation/CONTRACT.md):
 *
 * - the crowd slice for each walk edge around the player, which is exactly who
 *   is out on that pavement right now; each agent names the walk edge it is
 *   on, how far along and which way, so it is placed where the simulation says
 *   it is and then walks from there.
 * - the parcel crowd slice for buildings near the player, which is the set of
 *   workers on duty inside them; those stand in their building's lobby.
 *
 * A person in the world is a body of its own, kept under a handle of the
 * engine's own making, and the simulation handle it carries is the identity it
 * has been given for now: a street handle names a sampled agent for one epoch
 * of that pavement, and the same people come back under new handles every
 * epoch. So each refresh fits who is already out there to who the simulation
 * reports now instead of spawning them again, and whoever is left over retires.
 * That is what keeps the street at the density the simulation calibrated and
 * keeps every person on it somebody, rather than a crowd of passers-by nobody
 * can name. Movement follows the connections walk graph and holds at signalled
 * crossings until the walk phase.
 */
export class Crowd {

	constructor( { assets, routes, signals, sim, places, capacity, stress = 0, continuity = null } ) {

		this.assets = assets;
		this.routes = routes;
		this.signals = signals;
		this.sim = sim;
		this.places = places;
		this.capacity = capacity;
		this.stress = stress;
		this.continuity = continuity;
		this.members = new Map();
		this.timer = REFRESH_INTERVAL;
		/** People the simulation reported on the pavements around the player at
		 *  the last refresh: the number the crowd is kept at. */
		this.sampled = 0;
		/** People ever put in the world, which is what names each body. */
		this.spawns = 0;

		this.push = new THREE.Vector3();

	}

	/**
	 * Projects one persistent continuity actor into the instanced crowd. The
	 * actor's npcId and appearance seed own the body across every update.
	 */
	syncActor( actor, player ) {

		if ( ! actor ) return null;
		let member = [ ...this.members.values() ].find( ( candidate ) => candidate.npcId === actor.npcId ) ?? null;
		if ( member?.fallen ) return member;
		if ( ! actor.visible ) {

			if ( member?.continuity ) this.members.delete( member.id );
			return null;

		}
		const position = new THREE.Vector3( ...actor.position );
		const reach = actor.place.kind === 'parcel' ? PARCEL_RADIUS : SPAWN_RADIUS;
		if ( ! member && position.distanceTo( player ) > reach ) return null;
		const instance = this.sim.getNPC( actor.npcId );

		if ( ! member ) {

			if ( ! this.#makeRoomForQuest( player ) ) return null;
			member = this.#add( {
				...this.#base( {
					crowdId: `npc:${actor.npcId}`,
					type: actor.type,
					gender: actor.gender,
					activity: actor.schedule.activity
				}, actor.appearanceSeed ),
				stationary: true,
				quest: true,
				position: position.clone(),
				heading: actor.heading,
				clip: clipForNpcAnimation( actor.animation )
			} );

		}
		identify( member, instance );
		member.continuity = true;
		member.quest = true;
		member.frozen = true;
		member.retiring = false;
		member.position.copy( position );
		member.heading = actor.heading;
		member.restClip = clipForNpcAnimation( actor.animation );
		member.clip = member.animationOverride !== undefined
			? crowdClipForName( member.animationOverride )
			: member.talking
			? member.restClip === CLIP.SIT ? CLIP.SIT_TALK : CLIP.TALK
			: member.restClip;
		member.controlMode = actor.mode;
		member.parcelId = actor.place.kind === 'parcel' ? actor.place.id : null;
		member.edge = actor.place.kind === 'edge' ? this.routes.edges.get( actor.place.id ) ?? null : null;
		member.stationary = ! member.edge;
		member.distance = member.edge ? this.routes.project( actor.position )?.distance ?? 0 : 0;
		member.direction = 1;
		member.spot = actor.place.kind === 'parcel' ? `npc:${actor.npcId}` : null;
		return member;

	}

	syncActors( actors, player ) {

		return actors.map( ( actor ) => this.syncActor( actor, player ) ).filter( Boolean );

	}

	/** The rendered body for one persistent identity, if it is currently loaded. */
	memberForNpc( npcId ) {

		return [ ...this.members.values() ].find( ( member ) => member.npcId === npcId ) ?? null;

	}

	/**
	 * Projects an exact coordinator clip onto the baked crowd's closest authored
	 * VAT state. The exact clip still drives HeroCharacter while it is focused.
	 */
	setAnimationClip( npcId, clipName ) {

		const member = this.memberForNpc( npcId );
		if ( ! member ) return null;
		member.animationOverride = clipName;
		member.clip = crowdClipForName( clipName );
		return member;

	}

	/** Applies one actual simulation instance to a rendered body. */
	identify( member, instance ) {

		identify( member, instance );
		return member;

	}

	get count() {

		return this.members.size;

	}

	/** The exact rendered person named by an ImpactWorld contact. */
	member( id ) {

		return this.members.get( id ) ?? null;

	}

	/** Freezes one exact crowd identity while its Source rig is physics-driven. */
	beginRagdoll( id ) {

		const member = this.members.get( id );
		if ( ! member || member.fallen ) return null;
		member.frozenBeforeImpact = member.frozen;
		member.frozen = true;
		member.fallen = true;
		return member;

	}

	/** Restores the body's prior crowd control state after a rejected impact. */
	cancelRagdoll( id ) {

		const member = this.members.get( id );
		if ( ! member?.fallen ) return null;
		member.fallen = false;
		member.frozen = Boolean( member.frozenBeforeImpact );
		delete member.frozenBeforeImpact;
		return member;

	}

	update( delta, player, clock ) {

		this.timer += delta;

		if ( this.timer >= REFRESH_INTERVAL ) {

			this.timer = 0;
			this.#reconcile( player, clock.timeMin );

		}

		for ( const member of this.members.values() ) {

			this.#advance( member, delta, clock.daySeconds );

		}

		this.#write();

	}

	/**
	 * How far the player has to move to stop standing inside somebody. Nobody
	 * in the walking crowd is a dynamic physics body, so the player is pushed
	 * out of them instead: the whole overlap every frame, which is what makes walking
	 * through a person impossible, summed over everyone touching, so a knot of
	 * people shoulders the player aside instead of snapping them to one side.
	 *
	 * @param point the player's feet
	 * @param clearance the player's own radius
	 * @returns the XZ correction, zero when nobody is touching. Reused; copy it
	 * if it has to outlive the call.
	 */
	pushback( point, clearance ) {

		const reach = PERSON_RADIUS + clearance;

		this.push.set( 0, 0, 0 );

		for ( const member of this.members.values() ) {

			if ( member.fallen ) continue;
			if ( Math.abs( member.position.y - point.y ) > PERSON_HEIGHT ) continue;

			const dx = point.x - member.position.x;
			const dz = point.z - member.position.z;
			const distance = Math.hypot( dx, dz );

			if ( distance >= reach ) continue;

			// Exactly on top of each other has no direction to push along, so
			// pick one rather than divide by zero.
			if ( distance < 1e-4 ) {

				this.push.x += reach;
				continue;

			}

			const overlap = reach - distance;
			this.push.x += ( dx / distance ) * overlap;
			this.push.z += ( dz / distance ) * overlap;

		}

		return this.push;

	}

	/**
	 * Another live handle for this person, for when the one they spawned with
	 * has stopped answering: a street handle names a sampled agent for one
	 * epoch of that pavement, and people walk on long after it. The answer is
	 * whoever the simulation reports out on the street they are standing in
	 * now, of their own type where it has one, and never somebody another
	 * person in the crowd is already being.
	 *
	 * @returns a crowdId, or null where the simulation has nobody out there
	 */
	handleFor( member, timeMin ) {

		if ( member.stationary ) {

			return this.#pick(
				this.#agentsIn( timeMin, { kind: 'parcel', id: member.parcelId }, PARCEL_AGENTS ), member, 0
			);

		}

		const here = this.#pick(
			this.#agentsIn( timeMin, { kind: 'edge', id: member.edge.id }, EDGE_AGENTS ),
			member,
			member.distance / member.edge.length
		);

		if ( here ) return here;

		// A walker crosses the whole graph and ends up on stretches the
		// simulation keeps empty. Who is out on this street is still the
		// answer, so the question widens to the pavements a few doors down.
		const around = [];

		for ( const edge of this.routes.near( member.position, 0, STREET_REACH ) ) {

			if ( edge.id !== member.edge.id ) {

				around.push( ...this.#agentsIn( timeMin, { kind: 'edge', id: edge.id }, EDGE_AGENTS ) );

			}

		}

		return this.#pick( around, member, 0.5 );

	}

	/** One scope's sampled agents, empty where the simulation has no such scope. */
	#agentsIn( timeMin, scope, maxAgents ) {

		try {

			return this.sim.crowd( timeMin, scope, { maxAgents } ).agents;

		} catch {

			return [];

		}

	}

	/**
	 * Which of these agents this person is: their own gender always (a body is
	 * for life), their own type where the sample has one, nobody else in the
	 * crowd is already holding, standing closest to how far along the pavement
	 * they are.
	 */
	#pick( agents, member, progress ) {

		const taken = new Set();

		for ( const other of this.members.values() ) if ( other !== member ) taken.add( other.crowdId );

		const free = agents.filter( ( agent ) =>
			! taken.has( agent.crowdId ) && ( ! member.gender || ! agent.gender || agent.gender === member.gender ) );
		const pool = narrow( free, member.type );

		let best = null;
		let bestGap = Infinity;

		for ( const agent of pool ) {

			const gap = Math.abs( ( agent.progress ?? 0.5 ) - progress );

			if ( gap < bestGap ) {

				bestGap = gap;
				best = agent;

			}

		}

		return best ? best.crowdId : null;

	}

	/** Everyone within `radius`, for the crosshair to choose between. */
	within( position, radius ) {

		const out = [];
		const limit = radius * radius;

		for ( const member of this.members.values() ) {

			if ( member.fallen ) continue;
			if ( position.distanceToSquared( member.position ) < limit ) out.push( member );

		}

		return out;

	}

	/** Nearest member within `radius`, for the talk prompt. */
	nearest( position, radius ) {

		let best = null;
		let bestDistance = radius * radius;

		for ( const member of this.members.values() ) {

			if ( member.fallen ) continue;
			const distance = position.distanceToSquared( member.position );

			if ( distance < bestDistance ) {

				bestDistance = distance;
				best = member;

			}

		}

		return best;

	}

	/**
	 * Finds the rendered body of one already-cast quest NPC. Nearby anonymous
	 * crowd handles are resolved in stable order; if the simulation places the
	 * NPC at a parcel or walk edge that the regular sample omitted, one bounded
	 * quest body is posted there from that same NPC instance.
	 */
	questMember( npcId, timeMin, player, place, fallbackAnchor = null ) {

		if ( this.continuity ) {

			try {

				const actor = this.continuity.appear( { npcId, timeMin } );
				const member = this.syncActor( actor, player );
				return member && memberAt( member, place ) ? member : null;

			} catch {

				return null;

			}

		}

		for ( const member of this.members.values() ) {

			if ( member.npcId !== npcId ) continue;
			if ( memberAt( member, place ) ) return member;
			return null;

		}

		const npc = this.sim.getNPC( npcId );
		const candidates = [ ...this.members.values() ]
			.filter( ( member ) => ! member.copy && ! member.retiring && ! member.npcId && member.crowdId )
			.filter( ( member ) => member.type === npc.type && memberAt( member, place ) )
			.sort( ( left, right ) => left.id.localeCompare( right.id ) );

		for ( const member of candidates ) {

			const instance = this.sim.instantiate( member.crowdId, timeMin );
			if ( ! instance ) continue;
			identify( member, instance );
			if ( instance.npcId === npcId ) return member;

		}

		return this.#postQuestNpc( npc, timeMin, place, player, fallbackAnchor );

	}

	#reconcile( player, timeMin ) {

		this.#drop( player );

		const street = this.#streetAgents( timeMin, player );
		this.sampled = street.length;

		this.#fit( street, this.#walking(), ( entry ) => this.#place( entry ) );
		this.#staff( timeMin, player );
		this.#copies( street, player );

	}

	/** Everyone who has walked out of the world, and everyone retiring who has
	 *  got far enough back to go without being seen doing it. */
	#drop( player ) {

		for ( const [ id, member ] of this.members ) {

			if ( member.frozen ) continue;

			const reach = member.retiring ? RETIRE_RADIUS : DESPAWN_RADIUS;

			if ( member.position.distanceTo( player ) > reach ) this.members.delete( id );

		}

	}

	/**
	 * Fits the people already out there to the people the simulation reports
	 * now. Every reported agent is taken by the body that fits it best, of its
	 * own type and standing nearest to where the simulation puts it, so the
	 * pavement's next epoch renames the people already walking it instead of
	 * spawning them a second time. An agent nobody can be gets a new person,
	 * and every body left over retires.
	 *
	 * @param entries the sampled agents, each with the spot it is reported at
	 * @param candidates the bodies that may be handed one of those identities
	 * @param spawn makes a new person for an agent nobody could be
	 */
	#fit( entries, candidates, spawn ) {

		const free = new Set( candidates );

		for ( const entry of entries ) {

			const member = fitTo( free, entry.agent, entry.at );

			if ( ! member ) {

				spawn( entry );
				continue;

			}

			free.delete( member );
			this.#adopt( member, entry.agent );

		}

		for ( const member of free ) this.#retire( member );

	}

	/** The bodies out on the street that an identity can be handed to. */
	#walking() {

		const out = [];

		for ( const member of this.members.values() ) {

			if ( ! member.stationary && ! member.copy && ! member.continuity && ! member.frozen ) out.push( member );

		}

		return out;

	}

	/**
	 * Who this body is for now. Somebody the player has already met keeps the
	 * identity they were given: an instantiated NPC is the simulation's for
	 * good, and re-reading a handle for them would let a second body be them
	 * too. They still take the agent, which is what stops that second body.
	 */
	#adopt( member, agent ) {

		member.retiring = false;

		if ( member.npcId ) return;

		member.crowdId = agent.crowdId;
		member.type = agent.type;
		member.activity = agent.activity;

	}

	/**
	 * Nobody the simulation reports any more. They walk on and leave the world
	 * from behind rather than popping out of it, and they give up their
	 * identity on the way, so nobody in the crowd is ever a second copy of
	 * somebody else. Whoever is mid-conversation is never one of them.
	 */
	#retire( member ) {

		if ( member.frozen ) return;

		member.retiring = true;
		member.crowdId = null;
		if ( ! member.npcId ) member.instance = null;

	}

	/**
	 * Who the simulation says is on the sidewalks around the player: one radius
	 * scope around their feet, exactly the people inside it and no sample cap
	 * (../../../../simulation/CONTRACT.md), each with the spot on their pavement
	 * they are reported at.
	 */
	#streetAgents( timeMin, player ) {

		const out = [];
		const scope = { kind: 'radius', x: player.x, z: player.z, metres: SPAWN_RADIUS };

		for ( const agent of this.#agentsIn( timeMin, scope, this.capacity ) ) {

			if ( out.length >= this.capacity ) break;
			if ( agent.place.kind !== 'edge' ) continue;

			const walk = this.routes.edges.get( agent.place.id );

			if ( ! walk ) continue;

			const direction = agent.direction === - 1 ? - 1 : 1;
			const distance = THREE.MathUtils.clamp( agent.progress ?? 0.5, 0, 1 ) * walk.length;

			out.push( {
				agent, edge: walk, direction, distance,
				at: this.routes.pointAt( walk, distance, direction )
			} );

		}

		return out;

	}

	/**
	 * The people the simulation has inside the buildings around the player:
	 * whoever is on duty stands at one of the interior's work spots, a guest
	 * sits on one of its seats, and when the anchors run out a person stands
	 * in the lobby. A building is fitted the same way a pavement is: the rota
	 * moves through the day, so the people in it are the ones the simulation
	 * reports now, and the shift that went home retires.
	 */
	#staff( timeMin, player ) {

		for ( const [ parcelId, place ] of this.places ) {

			if ( place.inside.distanceTo( player ) > PARCEL_RADIUS ) continue;

			const entries = this.#agentsIn( timeMin, { kind: 'parcel', id: parcelId }, PARCEL_AGENTS )
				.map( ( agent ) => ( { agent, at: place.inside } ) );
			const candidates = [];

			for ( const member of this.members.values() ) {

				if ( member.parcelId === parcelId && ! member.quest ) candidates.push( member );

			}

			const taken = new Set( candidates.map( ( member ) => member.spot ) );

			this.#fit( entries, candidates, ( { agent } ) => this.#post( agent, parcelId, place, taken ) );

		}

	}

	/** Debug load test only: bodies with no identity of their own, kept at the
	 *  configured multiple of the real street, walking nearby pavements. */
	#copies( street, player ) {

		if ( ! this.stress || ! street.length ) return;

		const spread = this.routes.near( player, 0, SPAWN_RADIUS );
		const standing = [];

		for ( const member of this.members.values() ) {

			if ( member.copy && ! member.retiring ) standing.push( member );

		}

		const target = spread.length ? street.length * this.stress : 0;

		for ( let index = standing.length; index < target; index ++ ) {

			const { agent, direction, distance } = street[ index % street.length ];
			const seed = hash( `${agent.crowdId}#${index}` );
			const copy = this.#place(
				{ agent, edge: spread[ seed % spread.length ], direction, distance }, seed
			);

			if ( ! copy ) return;

			copy.copy = true;
			copy.crowdId = null;

		}

		for ( let index = target; index < standing.length; index ++ ) this.#retire( standing[ index ] );

	}

	/** @returns the new person, or null where the crowd is already full. */
	#place( { agent, edge, direction, distance }, seed = agent.appearanceSeed ?? hash( agent.crowdId ) ) {

		if ( this.members.size >= this.capacity ) return null;

		return this.#add( {
			...this.#base( agent, seed ),
			stationary: false,
			edge,
			direction,
			distance: Math.min( distance, edge.length ),
			clip: CLIP.WALK,
			position: new THREE.Vector3(),
			heading: 0,
			rng: mulberry( seed )
		} );

	}

	/** One person on the first free anchor of their kind, or on a lobby spot when the anchors are full. */
	#post( agent, parcelId, place, taken ) {

		if ( this.members.size >= this.capacity ) return null;

		const seed = agent.appearanceSeed ?? hash( agent.crowdId );
		const kind = agent.activity === 'working' ? 'work' : 'seat';
		const anchors = place.anchors?.[ kind ] ?? [];
		const index = firstFree( taken, kind );

		if ( index < anchors.length ) {

			const anchor = anchors[ index ];
			taken.add( `${kind}:${index}` );

			return this.#add( {
				...this.#base( agent, seed ),
				stationary: true,
				parcelId,
				spot: `${kind}:${index}`,
				clip: kind === 'seat' ? CLIP.SIT : CLIP.IDLE,
				position: anchor.position.clone(),
				heading: anchor.heading
			} );

		}

		const spot = firstFree( taken, 'lobby' );
		taken.add( `lobby:${spot}` );
		const angle = ( spot * 2.399 ) + ( seed % 100 ) / 100;
		const offset = 0.9 + ( spot % 3 ) * 0.8;

		return this.#add( {
			...this.#base( agent, seed ),
			stationary: true,
			parcelId,
			spot: `lobby:${spot}`,
			clip: CLIP.IDLE,
			position: new THREE.Vector3(
				place.inside.x + Math.sin( angle ) * offset,
				place.inside.y,
				place.inside.z + Math.cos( angle ) * offset
			),
			heading: place.heading + Math.PI + Math.sin( angle )
		} );

	}

	#add( member ) {

		member.id = `p${ this.spawns ++ }`;
		this.members.set( member.id, member );

		return member;

	}

	#base( agent, seed ) {

		return {
			id: null,
			crowdId: agent.crowdId,
			type: agent.type,
			gender: agent.gender ?? null,
			activity: agent.activity,
			npcId: null,
			instance: null,
			parcelId: null,
			spot: null,
			variant: bodyFor( agent.gender, seed ),
			look: look( seed ),
			appearanceSeed: seed,
			frame: seed % FRAMES,
			frozen: false,
			retiring: false,
			copy: false,
			waiting: false,
			pendingSignal: null
		};

	}

	#postQuestNpc( npc, timeMin, place, player, fallbackAnchor ) {

		const seed = npc.appearanceSeed ?? hash( `quest:${npc.npcId}` );
		let position;
		let parcelId = null;
		let edge = null;

		if ( place?.kind === 'parcel' ) {

			const parcel = this.places.get( place.id );
			const anchor = parcel?.inside ?? fallbackAnchor;
			if ( ! anchor || anchor.distanceTo( player ) > PARCEL_RADIUS ) return null;
			const angle = ( seed % 6283 ) / 1000;
			position = anchor.clone().add( new THREE.Vector3( Math.sin( angle ) * 0.8, 0, Math.cos( angle ) * 0.8 ) );
			parcelId = place.id;

		} else if ( place?.kind === 'edge' ) {

			const continuity = this.sim.continuityAt?.( npc.npcId, timeMin );
			const current = continuity?.movement?.current;
			if ( current && current.edgeId !== place.id ) return null;
			edge = this.routes.edges.get( current?.edgeId ?? place.id );
			if ( ! edge ) return null;
			const at = this.routes.pointAt( edge, edge.length * ( current?.progress ?? 0.5 ), 1 );
			position = new THREE.Vector3( at.x, walkY( edge, at ), at.z );
			if ( position.distanceTo( player ) > SPAWN_RADIUS ) return null;

		} else return null;

		if ( ! this.#makeRoomForQuest( player ) ) return null;

		const member = this.#add( {
			...this.#base( {
				crowdId: `quest:${npc.npcId}`, type: npc.type, gender: npc.gender, activity: 'leisure'
			}, seed ),
			stationary: true,
			quest: true,
			parcelId,
			edge,
			spot: `quest:${npc.npcId}`,
			clip: CLIP.IDLE,
			position,
			heading: angleTo( position, player )
		} );
		identify( member, npc );

		return member;

	}

	#makeRoomForQuest( player ) {

		if ( this.capacity < 1 ) return false;
		while ( this.members.size >= this.capacity ) {

			const victim = [ ...this.members.values() ]
				.filter( ( member ) => ! member.quest && ! member.frozen && ! member.hero && ! member.npcId )
				.sort( ( left, right ) =>
					Number( Boolean( left.npcId ) ) - Number( Boolean( right.npcId ) ) ||
					right.position.distanceToSquared( player ) - left.position.distanceToSquared( player ) ||
					left.id.localeCompare( right.id )
				)[ 0 ];
			if ( ! victim ) return false;
			this.members.delete( victim.id );

		}
		return true;

	}

	#advance( member, delta, daySeconds ) {

		if ( ! member.stationary && ! member.frozen ) {

			const blocked = member.waiting && ! this.signals.green( member.pendingSignal, daySeconds );

			if ( blocked ) {

				member.clip = CLIP.IDLE;

			} else {

				member.waiting = false;
				member.clip = CLIP.WALK;
				member.distance += WALK_SPEED * delta;

				if ( member.distance >= member.edge.length ) this.#step( member, daySeconds );

			}

			const spot = this.routes.pointAt(
				member.edge,
				Math.min( member.distance, member.edge.length ),
				member.direction
			);
			member.position.set( spot.x, walkY( member.edge, spot ), spot.z );
			member.heading = spot.heading;

		}

		const duration = this.assets.durations[ member.clip ] || 1;
		member.frame = ( member.frame + ( delta / duration ) * FRAMES ) % FRAMES;

	}

	/** At the end of an edge: pick the next one, and hold for a red crossing. */
	#step( member, daySeconds ) {

		const node = this.routes.exitNode( member.edge, member.direction );
		const next = this.routes.nextFrom( node, member.edge.id, member.rng );

		if ( ! next ) {

			member.direction *= - 1;
			member.distance = 0;

			return;

		}

		if ( next.edge.kind === 'crossing' && ! this.signals.green( next.edge.signal, daySeconds ) ) {

			member.distance = member.edge.length;
			member.waiting = true;
			member.pendingSignal = next.edge.signal;

			return;

		}

		member.edge = next.edge;
		member.direction = next.direction;
		member.distance = 0;
		member.waiting = false;

	}

	#write() {

		const counts = this.assets.variants.map( () => 0 );
		const ordered = [ ...this.members.values() ].sort( ( left, right ) => Number( Boolean( right.quest ) ) - Number( Boolean( left.quest ) ) );

		for ( const member of ordered ) {

			if ( member.hero ) continue;

			const slot = counts[ member.variant ];

			if ( slot >= this.capacity ) continue;

			for ( const mesh of this.assets.meshesOf( member.variant ) ) {

				mesh.setInstance( slot, member.position, member.heading, member.frame, member.clip, member.look );

			}

			counts[ member.variant ] = slot + 1;

		}

		for ( let variant = 0; variant < counts.length; variant ++ ) {

			for ( const mesh of this.assets.meshesOf( variant ) ) mesh.commit( counts[ variant ] );

		}

	}

}

function identify( member, instance ) {

	member.npcId = instance.npcId;
	member.instance = instance;
	member.type = instance.type;
	member.gender = instance.gender ?? member.gender;
	member.appearanceSeed = instance.appearanceSeed ?? member.appearanceSeed;
	if ( instance.appearanceSeed !== undefined ) {

		member.variant = bodyFor( member.gender, instance.appearanceSeed );
		member.look = look( instance.appearanceSeed );

	}

}

function memberAt( member, place ) {

	if ( ! place ) return false;
	if ( place.kind === 'parcel' ) return member.parcelId === place.id;
	if ( place.kind === 'edge' ) return member.edge?.id === place.id;
	return false;

}

function angleTo( from, to ) {

	return Math.atan2( to.x - from.x, to.z - from.z );

}

/** The nearest baked VAT state for an exact Pro animation clip. */
export function crowdClipForName( clipName ) {

	if ( /^Walk_(?:Loop|Formal_Loop)$/.test( clipName ) ) return CLIP.WALK;
	if ( /^Sprint_/.test( clipName ) ) return CLIP.RUN;
	if ( /^Crouch_/.test( clipName ) ) return CLIP.CROUCH;
	if ( clipName === 'Idle_Talking_Loop' ) return CLIP.TALK;
	if ( clipName === 'Sitting_Talking_Loop' ) return CLIP.SIT_TALK;
	if ( /^Sitting_/.test( clipName ) ) return CLIP.SIT;
	return CLIP.IDLE;

}

/**
 * Connections publishes network grade. The raised city pavement adds its
 * 12 cm surface to sidewalk and access edges; station floors and links already
 * carry their absolute level. A stair blends that surface lift away by the
 * bottom landing so both ends meet the rendered station exactly.
 */
function walkY( edge, spot ) {

	const clearance = 0.02;

	if ( edge.kind === 'sidewalk' || edge.kind === 'access' ) return spot.y + SIDEWALK_HEIGHT;

	if ( edge.kind !== 'stairs' ) return spot.y + clearance;

	let low = Infinity;
	let high = - Infinity;

	for ( const point of edge.path ) {

		low = Math.min( low, point[ 1 ] );
		high = Math.max( high, point[ 1 ] );

	}

	const t = high > low ? THREE.MathUtils.clamp( ( spot.y - low ) / ( high - low ), 0, 1 ) : 0;

	return spot.y + THREE.MathUtils.lerp( clearance, SIDEWALK_HEIGHT, t );

}

/**
 * The free body that best fits an agent: one of that agent's own type where
 * any is free, and of those the one standing nearest the spot the simulation
 * reports the agent at. Null where every body is taken, which is the crowd
 * being short of people and the caller spawning one.
 */
function fitTo( free, agent, at ) {

	let best = null;
	let bestType = 2;
	let bestGap = Infinity;

	for ( const member of free ) {

		// A body is for life: a walker never becomes somebody of the other gender.
		if ( member.gender && agent.gender && member.gender !== agent.gender ) continue;
		// A named person may hold only the crowd trip that established that
		// identity. Later statistical handles cannot rename or relocate them.
		if ( member.npcId && member.crowdId !== agent.crowdId ) continue;

		const typed = member.type === agent.type ? 0 : 1;
		const gap = ( at.x - member.position.x ) ** 2 + ( at.z - member.position.z ) ** 2;

		if ( typed > bestType || ( typed === bestType && gap >= bestGap ) ) continue;

		best = member;
		bestType = typed;
		bestGap = gap;

	}

	return best;

}

/** The agents of this person's type, or all of them when none is that type. */
function narrow( agents, type ) {

	const same = agents.filter( ( agent ) => agent.type === type );

	return same.length ? same : agents;

}

function hash( text ) {

	let h = 2166136261;

	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );

	return h >>> 0;

}

function mulberry( seed ) {

	let state = seed >>> 0;

	return () => {

		state = ( state + 0x6d2b79f5 ) >>> 0;
		let t = state;
		t = Math.imul( t ^ ( t >>> 15 ), t | 1 );
		t ^= t + Math.imul( t ^ ( t >>> 7 ), t | 61 );

		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/** The lowest index of a kind nobody in the building holds. */
function firstFree( taken, kind ) {

	let index = 0;
	while ( taken.has( `${kind}:${index}` ) ) index ++;
	return index;

}
