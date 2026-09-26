import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { CLIP, clipForNpcAnimation } from './CharacterAssets.js';
import { CROWD_MODELS, bodyFor } from './CharacterCatalog.js';
import { FRAMES } from './VatBaker.js';
import { look } from './Appearance.js';
import { spreadOnLanes, LANE_SPACING } from './LaneSpread.js';
import { streetBodies } from './StreetBodies.js';

/** How fast people walk. Everyone has their own pace inside this range. */
const WALK_SLOWEST = 0.9;
const WALK_FASTEST = 1.3;
const SPAWN_RADIUS = 90;
const DESPAWN_MARGIN = 25;
/** How far off somebody the simulation no longer reports may leave the world:
 *  far enough back that nobody is ever seen going out. */
const RETIRE_RADIUS = 60;
const REFRESH_INTERVAL = 3;
const PARCEL_RADIUS = 45;
/** People the simulation may report on one sidewalk edge. A 40 m edge never
 *  holds more than a handful, and the cap is per edge, not per city. */
const EDGE_AGENTS = 16;
const PARCEL_AGENTS = 8;
/** Where a person on duty stands, in order of preference, and where a guest sits. */
const POSTS = [ 'counter', 'work' ];
const SEATS = [ 'seat' ];
/** The space one person stands in, measured for the pushback only. */
const PERSON_RADIUS = 0.34;
/** Nobody is ever nearer anybody than this, at spawn or walking. */
const PERSONAL_SPACE = 0.6;
/** How fast a walker gives way to somebody in their space, metres a second. */
const GIVE_WAY = 1.5;
/** The furthest from the middle of a pavement a walker keeps to one side. */
const LANE_HALF = 0.6;
/** Places along a lane a body looks for room at spawn before taking its spot. */
const SPAWN_TRIES = 6;
/** Above or below this, the two are on different floors and never touch. */
const PERSON_HEIGHT = 2;
/** How far around a walker talk looks for the street they belong to. */
const STREET_REACH = 25;
/** How near a blocked footprint a walker looks at their next step: more than anybody walks in a frame. */
const BLOCK_LOOK = 1;

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

	/**
	 * @param blockers what walkers keep out of now: a function returning solid
	 * footprints on the pavement, `[{ center: { x, z }, width, depth, yawRadians }]`
	 */
	constructor( { assets, routes, signals, sim, places, capacity, spawnRadius = SPAWN_RADIUS, stress = 0, continuity = null, street = streetBodies, lighting = null, blockers = () => [] } ) {

		this.assets = assets;
		this.street = street;
		this.routes = routes;
		this.signals = signals;
		this.sim = sim;
		this.places = places;
		this.capacity = capacity;
		this.spawnRadius = spawnRadius;
		this.stress = stress;
		this.continuity = continuity;
		this.lighting = lighting;
		this.blockers = blockers;
		if ( lighting ) for ( let variant = 0; variant < assets.variants.length; variant ++ ) {

			for ( const mesh of assets.meshesOf( variant ) ) lighting.attach( mesh.mesh, capacity );

		}
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
		let member = this.memberForNpc( actor.npcId );
		if ( member ) this.#deduplicate( member );
		if ( member?.fallen ) return null;
		if ( ! actor.visible ) {

			if ( member?.continuity ) this.members.delete( member.id );
			return null;

		}
		const position = new THREE.Vector3( ...actor.position );
		const reservedSpot = member?.parcelId === actor.place.id && member.position.distanceToSquared( position ) < 0.0001
			? member.spot : null;
		const reach = actor.place.kind === 'parcel' ? PARCEL_RADIUS : this.spawnRadius;
		const nearEntrance = actor.place.kind === 'parcel' &&
			this.places.get( actor.place.id )?.inside.distanceTo( player ) <= PARCEL_RADIUS;
		if ( ! member && position.distanceTo( player ) > reach && ! nearEntrance ) return null;
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
		member.place = { ...actor.place };
		member.parcelId = actor.place.kind === 'parcel' ? actor.place.id : null;
		member.edge = actor.place.kind === 'edge' ? this.routes.edges.get( actor.place.id ) ?? null : null;
		member.stationary = ! member.edge;
		member.distance = member.edge ? this.routes.project( actor.position )?.distance ?? 0 : 0;
		member.direction = 1;
		// A saved post keeps its real anchor reserved even when streaming has
		// removed the old body, so the next staff sample cannot fill its seat.
		member.spot = actor.place.kind === 'parcel' ? actor.spot ?? reservedSpot ?? `npc:${actor.npcId}` : null;
		return member;

	}

	syncActors( actors, player ) {

		return actors.map( ( actor ) => this.syncActor( actor, player ) ).filter( Boolean );

	}

	/** The rendered body for one persistent identity, if it is currently loaded. */
	memberForNpc( npcId ) {

		// One pass, asked for every controlled actor every frame: the first body
		// of the highest identity priority, as a stable sort would pick it.
		let found = null;
		let priority = - 1;
		for ( const member of this.members.values() ) {

			if ( member.npcId !== npcId ) continue;
			const rank = identityPriority( member );
			if ( rank > priority ) {

				found = member;
				priority = rank;

			}

		}
		return found;

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

		const owned = this.memberForNpc( instance.npcId );
		identify( member, instance );
		const canonical = owned ?? member;
		this.#deduplicate( canonical );
		return canonical;

	}

	/** One established identity and one sampled handle can own only one body. */
	#deduplicate( canonical ) {

		for ( const [ id, member ] of this.members ) {

			if ( member === canonical || member.copy ) continue;
			if ( ( canonical.npcId && member.npcId === canonical.npcId ) ||
				( canonical.crowdId && member.crowdId === canonical.crowdId ) ) {

				this.street.leave( id );
				this.members.delete( id );

			}

		}

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
		this.street.enter( member );
		return member;

	}

	/** Restores the body's prior crowd control state after a rejected impact. */
	cancelRagdoll( id ) {

		const member = this.members.get( id );
		if ( ! member?.fallen ) return null;
		this.street.leave( id );
		member.fallen = false;
		member.frozen = Boolean( member.frozenBeforeImpact );
		delete member.frozenBeforeImpact;
		return member;

	}

	update( delta, player, clock ) {

		this.#settle( delta );
		this.timer += delta;

		if ( this.timer >= REFRESH_INTERVAL ) {

			this.timer = 0;
			this.#reconcile( player, clock.timeMin );

		}

		const blocked = this.blockers();
		for ( const member of this.members.values() ) {

			this.#advance( member, delta, clock.daySeconds, blocked );

		}

		this.#publish();
		this.#separate( delta );
		this.#write();

	}

	/** Everyone whose fall is over, taken back from the ground. */
	#settle( delta ) {

		this.street.advance( delta );

		for ( const record of this.street.done() ) {

			if ( this.members.get( record.member.id ) === record.member ) this.#rise( record.member );

		}

	}

	/**
	 * The end of a fall. The simulation decides who gets up: somebody it still
	 * has walks on from where they came to rest, and anybody it does not is out
	 * of the world and back to being one of that pavement's numbers.
	 */
	#rise( member ) {

		this.street.leave( member.id );
		member.fallen = false;
		member.frozen = Boolean( member.frozenBeforeImpact );
		delete member.frozenBeforeImpact;

		if ( ! this.#alive( member ) ) {

			this.members.delete( member.id );
			return null;

		}

		// A persistent identity is put back by its own schedule.
		if ( member.continuity || member.quest ) return member;

		const spot = this.routes.project( member.position.toArray() );

		if ( ! spot ) {

			this.members.delete( member.id );
			return null;

		}

		member.edge = spot.edge;
		member.distance = spot.distance;
		member.direction = 1;
		member.offset = 0;
		member.stationary = false;
		member.waiting = false;
		member.pendingSignal = null;
		member.clip = CLIP.WALK;
		this.#stand( member );

		return member;

	}

	/** Whether the simulation still has this person. An anonymous walker is
	 *  only ever one of its numbers, and it never buries one. */
	#alive( member ) {

		if ( ! member.npcId ) return true;

		try {

			return ! this.sim.getNPC( member.npcId )?.flags?.dead;

		} catch {

			return false;

		}

	}

	/** The street as everyone else reads it this frame. */
	#publish() {

		this.street.open();

		for ( const member of this.members.values() ) this.street.place( member );

	}

	/**
	 * Nobody walks through anybody. Walkers are not physical bodies, so a
	 * walker inside somebody else's space gives way itself: across the pavement
	 * as far as its width allows, and along it for the rest, at a pace that
	 * reads as stepping aside rather than sliding.
	 */
	#separate( delta ) {

		const step = GIVE_WAY * delta;

		for ( const member of this.members.values() ) {

			if ( member.stationary || member.frozen || ! member.edge ) continue;

			let along = 0;
			let across = 0;

			this.street.forEachNear( member.position, PERSONAL_SPACE, ( other, distance ) => {

				if ( other === member ) return;

				const room = ( PERSONAL_SPACE - distance ) / 2;
				const away = distance > 1e-4
					? [ ( member.position.x - other.position.x ) / distance, ( member.position.z - other.position.z ) / distance ]
					: [ Math.cos( member.heading ), - Math.sin( member.heading ) ];

				along += ( away[ 0 ] * Math.sin( member.heading ) + away[ 1 ] * Math.cos( member.heading ) ) * room;
				across += ( away[ 0 ] * Math.cos( member.heading ) - away[ 1 ] * Math.sin( member.heading ) ) * room;

			} );

			if ( ! along && ! across ) continue;

			const side = laneRoom( member.edge );
			const give = ( amount ) => THREE.MathUtils.clamp( amount, - step, step );

			member.distance = THREE.MathUtils.clamp( member.distance + give( along ), 0, member.edge.length );
			member.offset = THREE.MathUtils.clamp( member.offset + give( across ), - side, side );
			this.#stand( member );

		}

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
	 * now, of the body's own gender, of their own type where it has one, and
	 * never somebody another person in the crowd is already being or somebody
	 * the simulation has already established.
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
	 * Which of these agents this person is: the gender of the body they walk in
	 * always (a body is for life), their own type where the sample has one,
	 * nobody established and nobody else in the crowd is already holding,
	 * standing closest to how far along the pavement they are.
	 */
	#pick( agents, member, progress ) {

		const taken = new Set();

		for ( const other of this.members.values() ) if ( other !== member ) taken.add( other.crowdId );

		const free = agents.filter( ( agent ) =>
			! agent.npcId && ! taken.has( agent.crowdId ) && agent.gender === member.gender );
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
				this.#adoptQuestHandle( this.sim.getNPC( npcId ), timeMin, place );
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
		const adopted = this.#adoptQuestHandle( npc, timeMin, place );
		if ( adopted ) return adopted;

		return this.#postQuestNpc( npc, timeMin, place, player, fallbackAnchor );

	}

	/**
	 * The body of one cast NPC the story wants at a parcel now: the person a
	 * talk step sends the player to stands where the player is sent, at the
	 * interior's counter, else a work spot, else just inside the door. A body
	 * this npcId already owns counts only while it is at that parcel; one that
	 * has walked off is put back through continuity, so the next schedule
	 * projection keeps it there instead of taking it home.
	 */
	castMember( npcId, timeMin, player, parcelId, { meeting = false } = {} ) {

		const at = { kind: 'parcel', id: parcelId };
		const owned = this.memberForNpc( npcId );
		if ( owned?.fallen ) return null;
		let present = owned && memberAt( owned, at ) ? owned : null;
		const alreadyMeeting = present?.spot?.startsWith( 'meeting:' );
		if ( present && ( ! meeting || alreadyMeeting || present.controlMode === 'conversation' ) &&
			( ! this.continuity || [ 'posing', 'conversation' ].includes( present.controlMode ) ) ) {

			present.quest = true;
			present.frozen = true;
			return present;

		}

		const place = this.places.get( parcelId );
		if ( ! place || place.inside.distanceTo( player ) > PARCEL_RADIUS ) return null;

		const npc = this.sim.getNPC( npcId );
		if ( ! owned ) {

			present = this.#adoptQuestHandle( npc, timeMin, at );

		}

		const seed = npc.appearanceSeed ?? hash( `quest:${npcId}` );
		const spot = meeting && ! alreadyMeeting
			? this.#meetingAt( place, this.#spotsAt( parcelId ) )
			: present
			? { position: present.position, heading: present.heading, spot: present.spot }
			: this.#anchorAt( place, this.#spotsAt( parcelId ), POSTS, seed );

		if ( this.continuity ) {

			try {

				const member = this.syncActor( this.continuity.hold( {
					npcId, timeMin, place: at, position: spot.position.toArray(), heading: spot.heading,
					...( ! meeting && present && [ CLIP.SIT, CLIP.SIT_TALK ].includes( present.clip ) ? { seated: true } : {} )
				} ), player );
				// Retain the actual anchor reservation: replacing it with npc:id
				// lets the next appointment occupy the same counter or work spot.
				if ( member ) member.spot = spot.spot;
				return member;

			} catch {

				return null;

			}

		}
		if ( present || owned ) {

			const member = present ?? owned;
			member.position.copy( spot.position );
			Object.assign( member, { heading: spot.heading, spot: spot.spot, parcelId, place: at, stationary: true, quest: true, frozen: true } );
			return member;

		}

		if ( ! this.#makeRoomForQuest( player ) ) return null;
		const member = this.#add( {
			...this.#base( { crowdId: `quest:${npcId}`, type: npc.type, gender: npc.gender, activity: 'working' }, seed ),
			stationary: true,
			quest: true,
			frozen: true,
			parcelId,
			...spot
		} );
		identify( member, npc );

		return member;

	}

	/**
	 * An anonymous body already standing where the quest wants its person, when
	 * the simulation says that handle is that person. The crowd sample names an
	 * established person on every handle that is theirs, and reading it
	 * establishes nobody, so only the match is named: a passer-by the search
	 * walked past keeps being a passer-by, in their own look.
	 */
	#adoptQuestHandle( npc, timeMin, place ) {

		const owned = this.memberForNpc( npc.npcId );
		if ( owned ) {

			this.#deduplicate( owned );
			return owned;

		}
		const scope = place?.kind === 'parcel' || place?.kind === 'edge' ? { kind: place.kind, id: place.id } : null;
		const handle = scope && this.#agentsIn( timeMin, scope, this.capacity ).find( ( agent ) => agent.npcId === npc.npcId );
		const member = handle && [ ...this.members.values() ].find( ( candidate ) =>
			candidate.crowdId === handle.crowdId && ! candidate.npcId && ! candidate.copy && ! candidate.fallen && memberAt( candidate, place ) );
		if ( ! member ) return null;
		identify( member, npc );

		return member;

	}

	#reconcile( player, timeMin ) {

		this.#drop( player );

		const street = spreadOnLanes( this.#streetAgents( timeMin, player ), this.routes );
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

			const reach = member.retiring ? RETIRE_RADIUS : this.spawnRadius + DESPAWN_MARGIN;

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

			// A continuity, dialogue or quest body still consumes its sample.
			// Excluding it from the movable candidates must not spawn its twin.
			const owned = entry.agent.npcId ? this.memberForNpc( entry.agent.npcId ) : null;
			const handle = [ ...this.members.values() ].find( ( member ) => ! member.copy && member.crowdId === entry.agent.crowdId );
			const existing = owned ?? handle;
			if ( owned && handle && handle !== owned ) identify( handle, this.sim.getNPC( entry.agent.npcId ) );
			if ( existing ) {

				if ( entry.agent.npcId && ! existing.npcId ) identify( existing, this.sim.getNPC( entry.agent.npcId ) );
				this.#deduplicate( existing );
				for ( const candidate of free ) if ( ! this.members.has( candidate.id ) ) free.delete( candidate );
				if ( ! free.has( existing ) ) continue;

			}
			const member = existing ?? fitTo( free, entry.agent, entry.at );

			if ( ! member ) {

				spawn( entry );
				continue;

			}

			free.delete( member );
			this.#adopt( member, entry.agent );

		}

		for ( const member of free ) if ( this.members.has( member.id ) ) this.#retire( member );

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
		if ( agent.npcId ) identify( member, this.sim.getNPC( agent.npcId ) );

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
		const scope = { kind: 'radius', x: player.x, z: player.z, metres: this.spawnRadius };

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

			// A cast body posted here by the story keeps its spot.
			const taken = this.#spotsAt( parcelId );

			this.#fit( entries, candidates, ( { agent } ) => this.#post( agent, parcelId, place, taken ) );

		}

	}

	/** Debug load test only: bodies with no identity of their own, kept at the
	 *  configured multiple of the real street, walking nearby pavements. */
	#copies( street, player ) {

		if ( ! this.stress || ! street.length ) return;

		const spread = this.routes.near( player, 0, this.spawnRadius );
		const standing = [];

		for ( const member of this.members.values() ) {

			if ( member.copy && ! member.retiring ) standing.push( member );

		}

		const target = spread.length ? street.length * this.stress : 0;

		for ( let index = standing.length; index < target; index ++ ) {

			const { agent, direction, distance } = street[ index % street.length ];
			const seed = hash( `${agent.crowdId}#${index}` );
			// A copy walks like its agent and is nobody: no handle, no identity, a look of its own.
			const nobody = { type: agent.type, gender: agent.gender, activity: agent.activity, crowdId: null };
			const copy = this.#place(
				{ agent: nobody, edge: spread[ seed % spread.length ], direction, distance }, seed
			);

			if ( ! copy ) return;

			copy.copy = true;

		}

		for ( let index = target; index < standing.length; index ++ ) this.#retire( standing[ index ] );

	}

	/** @returns the new person, or null where the crowd is already full. */
	#place( { agent, edge, direction, distance, slot }, seed = agent.appearanceSeed ?? hash( agent.crowdId ) ) {

		if ( this.members.size >= this.capacity ) return null;

		const rng = mulberry( seed );
		const spot = this.#freeSpot(
			edge, Math.min( distance, edge.length ), direction, laneOffset( slot ?? seed, edge )
		);
		const member = this.#add( {
			...this.#base( agent, seed ),
			stationary: false,
			edge,
			direction,
			distance: spot.distance,
			offset: spot.offset,
			speed: WALK_SLOWEST + rng() * ( WALK_FASTEST - WALK_SLOWEST ),
			// Nobody starts on the same footfall as the person beside them.
			frame: rng() * FRAMES,
			clip: CLIP.WALK,
			position: new THREE.Vector3(),
			heading: 0,
			rng
		} );
		this.#stand( member );

		return member;

	}

	/**
	 * Where a new body stands on its lane: the spot the simulation reported, or
	 * the nearest step along the lane, on whichever side of it, that nobody is
	 * standing in. Corners are where two lanes meet on one point, so the side
	 * matters as much as the step. Where the whole stretch is taken it takes
	 * the roomiest spot on it.
	 */
	#freeSpot( edge, distance, direction, offset ) {

		let best = null;

		for ( let step = 0; step <= SPAWN_TRIES; step ++ ) {

			for ( const shift of step ? [ step * LANE_SPACING, - step * LANE_SPACING ] : [ 0 ] ) {

				const along = THREE.MathUtils.clamp( distance + shift, 0, edge.length );
				const spot = this.routes.pointAt( edge, along, direction );

				for ( const side of [ offset, - offset, 0 ] ) {

					const gap = this.#roomAt( standing( edge, spot, side ) );

					if ( gap >= PERSONAL_SPACE ) return { distance: along, offset: side };
					if ( ! best || gap > best.gap ) best = { distance: along, offset: side, gap };

				}

			}

		}

		return { distance: best.distance, offset: best.offset };

	}

	/** How near the closest person already standing at a spot is. */
	#roomAt( at, self = null ) {

		let nearest = Infinity;

		for ( const member of this.members.values() ) {

			if ( member === self ) continue;
			if ( Math.abs( member.position.y - at.y ) > PERSON_HEIGHT ) continue;
			nearest = Math.min( nearest, Math.hypot( member.position.x - at.x, member.position.z - at.z ) );

		}

		return nearest;

	}

	/** One person on the first free anchor of their kind, or on a lobby spot when the anchors are full. */
	#post( agent, parcelId, place, taken ) {

		if ( this.members.size >= this.capacity ) return null;

		const seed = agent.appearanceSeed ?? hash( agent.crowdId );

		return this.#add( {
			...this.#base( agent, seed ),
			stationary: true,
			parcelId,
			...this.#anchorAt( place, taken, agent.activity === 'working' ? POSTS : SEATS, seed )
		} );

	}

	/** The spots the bodies inside a building hold, the story's cast included. */
	#spotsAt( parcelId ) {

		const taken = new Set();

		for ( const member of this.members.values() ) if ( member.parcelId === parcelId ) taken.add( member.spot );

		return taken;

	}

	/** A listening group meets together in the entrance circulation space.
	 * Two arbitrary service posts can be on opposite sides of a large floor.
	 * The published inside point is 1.8 m behind the door; step farther inside
	 * and put partners 1.3 m apart, facing one another rather than a wall.
	 */
	#meetingAt( place, taken ) {

		const index = firstFree( taken, 'meeting' );
		const side = index % 2 === 0 ? - 0.65 : 0.65;
		const inward = 0.8 + Math.floor( index / 2 ) * 1.1;
		return {
			spot: `meeting:${index}`,
			position: place.inside.clone().add( new THREE.Vector3(
				- Math.sin( place.heading ) * inward + Math.cos( place.heading ) * side,
				0,
				- Math.cos( place.heading ) * inward - Math.sin( place.heading ) * side
			) ),
			heading: place.heading + ( index % 2 === 0 ? Math.PI / 2 : - Math.PI / 2 )
		};

	}

	/**
	 * Where a body stands inside a building: the first free anchor of the
	 * kinds wanted, in that order, or a spot in the lobby around the door when
	 * they are all held.
	 */
	#anchorAt( place, taken, kinds, seed ) {

		for ( const kind of kinds ) {

			const anchors = place.anchors?.[ kind ] ?? [];
			const index = firstFree( taken, kind );

			if ( index >= anchors.length ) continue;

			taken.add( `${kind}:${index}` );

			return {
				spot: `${kind}:${index}`,
				clip: kind === 'seat' ? CLIP.SIT : CLIP.IDLE,
				position: anchors[ index ].position.clone(),
				heading: anchors[ index ].heading
			};

		}

		const spot = firstFree( taken, 'lobby' );
		taken.add( `lobby:${spot}` );
		const angle = ( spot * 2.399 ) + ( seed % 100 ) / 100;
		const offset = 0.9 + ( spot % 3 ) * 0.8;

		return {
			spot: `lobby:${spot}`,
			clip: CLIP.IDLE,
			position: new THREE.Vector3(
				place.inside.x + Math.sin( angle ) * offset,
				place.inside.y,
				place.inside.z + Math.cos( angle ) * offset
			),
			heading: place.heading + Math.PI + Math.sin( angle )
		};

	}

	#add( member ) {

		member.id = `p${ this.spawns ++ }`;
		this.members.set( member.id, member );

		return member;

	}

	/** A new body for one sampled agent: an established person's own body and look, else the given seed's. */
	#base( agent, seed ) {

		const instance = agent.npcId ? this.sim.getNPC( agent.npcId ) : null;
		return {
			id: null,
			crowdId: agent.crowdId,
			type: agent.type,
			activity: agent.activity,
			npcId: instance?.npcId ?? null,
			instance,
			parcelId: null,
			spot: null,
			...wearing( null, instance?.gender ?? agent.gender, instance?.appearanceSeed ?? seed ),
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
			if ( position.distanceTo( player ) > this.spawnRadius ) return null;

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

	#advance( member, delta, daySeconds, blocked ) {

		if ( ! member.stationary && ! member.frozen ) {

			const held = member.waiting && ! this.signals.green( member.pendingSignal, daySeconds );

			if ( held ) {

				member.clip = CLIP.IDLE;

			} else {

				member.waiting = false;
				member.clip = CLIP.WALK;
				const distance = member.distance + member.speed * delta;

				if ( this.#walksInto( member, distance, blocked ) ) this.#turnBack( member );
				else {

					member.distance = distance;
					if ( member.distance >= member.edge.length ) this.#step( member, daySeconds );

				}

			}

			this.#stand( member );

		}

		const duration = this.assets.durations[ member.clip ] || 1;
		member.frame = ( member.frame + ( delta / duration ) * FRAMES ) % FRAMES;

	}

	/**
	 * Whether the step to `distance` takes a walker into a blocked footprint
	 * it is not already inside; one already inside walks out.
	 */
	#walksInto( member, distance, blocked ) {

		let next = null;
		for ( const footprint of blocked ) {

			if ( ! covers( footprint, member.position, PERSON_RADIUS + BLOCK_LOOK ) || covers( footprint, member.position, PERSON_RADIUS ) ) continue;
			next ??= standing( member.edge, this.routes.pointAt( member.edge, Math.min( distance, member.edge.length ), member.direction ), member.offset );
			if ( covers( footprint, next, PERSON_RADIUS ) ) return true;

		}
		return false;

	}

	/** Walks back the way the walker came, from where they stand. */
	#turnBack( member ) {

		member.direction *= - 1;
		member.distance = member.edge.length - Math.min( member.distance, member.edge.length );
		member.offset = - member.offset;

	}

	/** At the end of an edge: pick the next one, and hold for a red crossing. */
	#step( member, daySeconds ) {

		const node = this.routes.exitNode( member.edge, member.direction );
		const next = this.routes.nextFrom( node, member.edge.id, member.rng );

		if ( ! next ) {

			member.direction *= - 1;
			member.distance = 0;
			member.offset = this.#turnSide( member, member.edge, member.direction );

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
		member.offset = this.#turnSide( member, next.edge, next.direction );

	}

	/**
	 * Which side of the next stretch a walker carries their line onto. Their
	 * own where it is free, so people hold their line around a corner, and the
	 * nearest free one where somebody is already standing on the node: a corner
	 * is one point two pavements share, and a group taking it never meets there.
	 */
	#turnSide( member, edge, direction ) {

		const room = laneRoom( edge );
		const own = THREE.MathUtils.clamp( member.offset, - room, room );
		const spot = this.routes.pointAt( edge, 0, direction );
		let best = null;

		for ( const side of [ own, - own, 0, room, - room ] ) {

			const gap = this.#roomAt( standing( edge, spot, side ), member );

			if ( gap >= PERSONAL_SPACE ) return side;
			if ( ! best || gap > best.gap ) best = { side, gap };

		}

		return best.side;

	}

	/**
	 * Where a walker stands: their lane at their distance along it, out to the
	 * side of it they keep.
	 */
	#stand( member ) {

		const spot = this.routes.pointAt(
			member.edge,
			Math.min( member.distance, member.edge.length ),
			member.direction
		);
		const at = standing( member.edge, spot, member.offset );

		member.position.set( at.x, at.y, at.z );
		member.heading = spot.heading;

	}

	#write() {

		const counts = this.assets.variants.map( () => 0 );
		const ordered = [ ...this.members.values() ].sort( ( left, right ) => Number( Boolean( right.quest ) ) - Number( Boolean( left.quest ) ) );

		for ( const member of ordered ) {

			if ( member.hero ) continue;

			const slot = counts[ member.variant ];

			if ( slot >= this.capacity ) continue;
			const fill = this.lighting?.fillAt( member.position );

			for ( const mesh of this.assets.meshesOf( member.variant ) ) {

				mesh.setInstance( slot, member.position, member.heading, member.frame, member.clip, member.look );
				this.lighting?.write( mesh.mesh, slot, fill );

			}

			counts[ member.variant ] = slot + 1;

		}

		for ( let variant = 0; variant < counts.length; variant ++ ) {

			for ( const mesh of this.assets.meshesOf( variant ) ) mesh.commit( counts[ variant ] );

		}

	}

}

function identityPriority( member ) {

	return member.hero || member.controlMode === 'conversation' ? 4
		: member.fallen ? 3 : member.continuity ? 2 : member.quest ? 1 : 0;

}

/** Makes a body this simulation person: their type, and the body and look their gender and seed give. */
function identify( member, instance ) {

	member.npcId = instance.npcId;
	member.instance = instance;
	member.type = instance.type;
	Object.assign( member, wearing( member, instance.gender ?? member.gender, instance.appearanceSeed ?? member.appearanceSeed ) );

}

/**
 * The body and look one gender and seed give: a known gender picks its mesh,
 * and a body of unknown gender carries the gender of the mesh the seed picks,
 * so a body is always one gender. The look is built again only when the seed
 * or the mesh changes, so a person keeps one look object for as long as it is
 * theirs.
 *
 * @param member the body wearing them now, or null for a new one
 */
function wearing( member, gender, seed ) {

	const variant = bodyFor( gender, seed );
	const same = member?.look && member.appearanceSeed === seed && member.variant === variant;
	return {
		gender: gender ?? CROWD_MODELS[ variant ].gender,
		variant,
		appearanceSeed: seed,
		look: same ? member.look : look( seed )
	};

}

function memberAt( member, place ) {

	if ( ! place ) return false;
	if ( member.place?.id === place.id ) {

		if ( member.place.kind === place.kind ) return true;
		if ( member.place.kind === 'stop' && place.kind === 'station' ) return true;

	}
	if ( place.kind === 'parcel' ) return member.parcelId === place.id;
	if ( place.kind === 'edge' ) return member.edge?.id === place.id;
	return false;

}

function angleTo( from, to ) {

	return Math.atan2( to.x - from.x, to.z - from.z );

}

/** Whether a point on the ground lies in a footprint grown by `margin` on every side. */
function covers( { center, width, depth, yawRadians }, point, margin ) {

	const dx = point.x - center.x;
	const dz = point.z - center.z;
	const cos = Math.cos( yawRadians );
	const sin = Math.sin( yawRadians );
	return Math.abs( dx * cos - dz * sin ) <= width / 2 + margin && Math.abs( dx * sin + dz * cos ) <= depth / 2 + margin;

}

/** How far off the middle of a pavement a walker may keep, by its width. A
 *  stretch that publishes no width is walked down the middle. */
function laneRoom( edge ) {

	return edge.width > 0 ? Math.max( 0, Math.min( LANE_HALF, edge.width / 2 - PERSON_RADIUS ) ) : 0;

}

/** The world spot a walker stands on: their lane's point, out to their side. */
function standing( edge, spot, offset ) {

	return {
		x: spot.x + Math.cos( spot.heading ) * offset,
		y: walkY( edge, spot ),
		z: spot.z - Math.sin( spot.heading ) * offset
	};

}

/** Which side of the pavement one walker keeps: three abreast at the widest. */
function laneOffset( slot, edge ) {

	return ( ( Math.abs( Math.round( slot ) ) % 3 ) - 1 ) * laneRoom( edge );

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
 * shared surface datum to sidewalk and access edges; station floors and links already
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
		// An established person is drawn in their own look: a passer-by in
		// another one is never re-dressed as them.
		if ( agent.npcId && ! member.npcId && member.appearanceSeed !== agent.appearanceSeed ) continue;

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
