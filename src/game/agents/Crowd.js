import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { CLIP } from './CharacterAssets.js';
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

	constructor( { assets, routes, signals, sim, places, capacity, stress = 0 } ) {

		this.assets = assets;
		this.routes = routes;
		this.signals = signals;
		this.sim = sim;
		this.places = places;
		this.capacity = capacity;
		this.stress = stress;
		this.members = new Map();
		this.timer = REFRESH_INTERVAL;
		/** People the simulation reported on the pavements around the player at
		 *  the last refresh: the number the crowd is kept at. */
		this.sampled = 0;
		/** People ever put in the world, which is what names each body. */
		this.spawns = 0;

		this.push = new THREE.Vector3();

	}

	get count() {

		return this.members.size;

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
	 * in the crowd is a physics body, so the player is pushed out of them
	 * instead: the whole overlap every frame, which is what makes walking
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
	 * Which of these agents this person is: their own type where the sample has
	 * one, nobody else in the crowd is already holding, standing closest to how
	 * far along the pavement they are.
	 */
	#pick( agents, member, progress ) {

		const taken = new Set();

		for ( const other of this.members.values() ) if ( other !== member ) taken.add( other.crowdId );

		const pool = narrow( agents.filter( ( agent ) => ! taken.has( agent.crowdId ) ), member.type );

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

			if ( position.distanceToSquared( member.position ) < limit ) out.push( member );

		}

		return out;

	}

	/** Nearest member within `radius`, for the talk prompt. */
	nearest( position, radius ) {

		let best = null;
		let bestDistance = radius * radius;

		for ( const member of this.members.values() ) {

			const distance = position.distanceToSquared( member.position );

			if ( distance < bestDistance ) {

				bestDistance = distance;
				best = member;

			}

		}

		return best;

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

			if ( ! member.stationary && ! member.copy ) out.push( member );

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
		member.npcId = null;
		member.instance = null;

	}

	/**
	 * Who the simulation says is on the sidewalks around the player, asked edge
	 * by edge, each with the spot on that pavement it is reported at. A single
	 * city-scope slice is a sample of the whole city, so at any cap most of it
	 * lands out of sight and the street in front of the player starves; the
	 * edge scope answers for that edge alone.
	 */
	#streetAgents( timeMin, player ) {

		const out = [];

		for ( const edge of this.routes.near( player, 0, SPAWN_RADIUS ) ) {

			if ( out.length >= this.capacity ) break;

			for ( const agent of this.#agentsIn( timeMin, { kind: 'edge', id: edge.id }, EDGE_AGENTS ) ) {

				if ( agent.place.kind !== 'edge' ) continue;

				const walk = this.routes.edges.get( agent.place.id ) ?? edge;
				const direction = agent.direction === - 1 ? - 1 : 1;
				const distance = THREE.MathUtils.clamp( agent.progress ?? 0.5, 0, 1 ) * walk.length;

				out.push( {
					agent, edge: walk, direction, distance,
					at: this.routes.pointAt( walk, distance, direction )
				} );

			}

		}

		return out;

	}

	/**
	 * On-duty staff in the buildings around the player, standing in the lobby.
	 * A lobby is fitted the same way a pavement is: the rota moves through the
	 * day, so the people standing in it are the shift the simulation reports
	 * now, and the shift that went home retires.
	 */
	#staff( timeMin, player ) {

		for ( const [ parcelId, place ] of this.places ) {

			if ( place.inside.distanceTo( player ) > PARCEL_RADIUS ) continue;

			const entries = this.#agentsIn( timeMin, { kind: 'parcel', id: parcelId }, PARCEL_AGENTS )
				.map( ( agent ) => ( { agent, at: place.inside } ) );
			const candidates = [];

			for ( const member of this.members.values() ) {

				if ( member.parcelId === parcelId ) candidates.push( member );

			}

			const spots = new Set( candidates.map( ( member ) => member.spot ) );

			this.#fit( entries, candidates, ( { agent } ) => {

				let spot = 0;

				while ( spots.has( spot ) ) spot ++;

				spots.add( spot );
				this.#stand( agent, parcelId, place, spot );

			} );

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
	#place( { agent, edge, direction, distance }, seed = hash( agent.crowdId ) ) {

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

	/** One worker on their own spot in a lobby, facing the room. */
	#stand( agent, parcelId, place, spot ) {

		if ( this.members.size >= this.capacity ) return null;

		const seed = hash( agent.crowdId );
		const angle = ( spot * 2.399 ) + ( seed % 100 ) / 100;
		const offset = 0.9 + ( spot % 3 ) * 0.8;

		return this.#add( {
			...this.#base( agent, seed ),
			stationary: true,
			parcelId,
			spot,
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
			activity: agent.activity,
			npcId: null,
			instance: null,
			parcelId: null,
			spot: null,
			variant: seed % 2,
			look: look( seed ),
			frame: seed % FRAMES,
			frozen: false,
			retiring: false,
			copy: false,
			waiting: false,
			pendingSignal: null
		};

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
			member.position.set( spot.x, member.edge.kind === 'crossing' ? 0.02 : SIDEWALK_HEIGHT, spot.z );
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

		for ( const member of this.members.values() ) {

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
