import * as THREE from 'three/webgpu';
import { SIDEWALK_HEIGHT } from '../ground/GroundBuilder.js';
import { CLIP } from './CharacterAssets.js';
import { FRAMES } from './VatBaker.js';

const WALK_SPEED = 1.4;
const SPAWN_RADIUS = 90;
const DESPAWN_RADIUS = 115;
const REFRESH_INTERVAL = 3;
const PARCEL_RADIUS = 45;

// Night-street clothing. The base character models ship undressed, so the tint
// multiplies their skin map into a bodysuit: the hues stay off-skin on purpose,
// and mid-toned, because darker than this is a black smear under a street lamp
// and lighter reads as bare.
const TINTS = [
	0x5b6b86, 0x7a4a52, 0x4d6b5f, 0x6b5f7a, 0x8a6a4a,
	0x556070, 0x6e4f6b, 0x4a5f6b, 0x7d6f5a, 0x5f5f6b
];

/**
 * The people in the world, all of them real. Two sources, both the simulation
 * library's own (../simulation/CONTRACT.md):
 *
 * - the city crowd slice, which is exactly who is out on the street right now;
 *   each agent names the walk edge it is on, how far along and which way, so
 *   it is placed where the simulation says it is and then walks from there.
 * - the parcel crowd slice for buildings near the player, which is the set of
 *   workers on duty inside them; those stand in their building's lobby.
 *
 * Every spawned person keeps its crowdId, which is the handle that turns it
 * into a full NPC the moment the player talks to it. Movement follows the
 * connections walk graph and holds at signalled crossings until the walk phase.
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
		this.sampled = 0;

		this.color = new THREE.Color();

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

		for ( const [ id, member ] of this.members ) {

			if ( member.frozen ) continue;

			const distance = member.position.distanceTo( player );

			if ( distance > DESPAWN_RADIUS ) this.members.delete( id );

		}

		const walkers = this.#streetAgents( timeMin, player );
		this.sampled = walkers.length;

		for ( const { agent, edge } of walkers ) {

			this.#place( agent.crowdId, agent, edge );

			for ( let copy = 1; copy <= this.stress; copy ++ ) {

				const spread = this.routes.near( player, 0, SPAWN_RADIUS );

				if ( ! spread.length ) break;

				this.#place(
					`${agent.crowdId}#${copy}`,
					agent,
					spread[ ( hash( agent.crowdId ) + copy * 7 ) % spread.length ]
				);

			}

		}

		this.#workers( timeMin, player );

	}

	/**
	 * The city slice is the authoritative set of people on the street; keeping
	 * the ones whose edge is near the player is a filter, never a top-up.
	 */
	#streetAgents( timeMin, player ) {

		let slice;

		try {

			slice = this.sim.crowd( timeMin, { kind: 'city' }, { maxAgents: Math.max( 64, this.capacity ) } );

		} catch {

			return [];

		}

		const out = [];

		for ( const agent of slice.agents ) {

			if ( agent.place.kind !== 'edge' ) continue;

			const edge = this.routes.edges.get( agent.place.id );

			if ( ! edge ) continue;
			if ( Math.hypot( edge.mid[ 0 ] - player.x, edge.mid[ 1 ] - player.z ) > SPAWN_RADIUS ) continue;

			out.push( { agent, edge } );

		}

		return out;

	}

	/** On-duty staff in the buildings around the player, standing in the lobby. */
	#workers( timeMin, player ) {

		for ( const [ parcelId, place ] of this.places ) {

			if ( this.members.size >= this.capacity ) return;
			if ( place.inside.distanceTo( player ) > PARCEL_RADIUS ) continue;

			let slice;

			try {

				slice = this.sim.crowd( timeMin, { kind: 'parcel', id: parcelId }, { maxAgents: 6 } );

			} catch {

				continue;

			}

			let index = 0;

			for ( const agent of slice.agents ) {

				if ( this.members.has( agent.crowdId ) ) {

					index ++;
					continue;

				}

				const seed = hash( agent.crowdId );
				const angle = ( index * 2.399 ) + ( seed % 100 ) / 100;
				const offset = 0.9 + ( index % 3 ) * 0.8;

				this.members.set( agent.crowdId, {
					...this.#base( agent.crowdId, agent, seed ),
					stationary: true,
					clip: CLIP.IDLE,
					position: new THREE.Vector3(
						place.inside.x + Math.sin( angle ) * offset,
						place.inside.y,
						place.inside.z + Math.cos( angle ) * offset
					),
					heading: place.heading + Math.PI + Math.sin( angle )
				} );

				index ++;

			}

		}

	}

	#place( id, agent, edge ) {

		if ( this.members.has( id ) || this.members.size >= this.capacity ) return;

		const seed = hash( id );

		this.members.set( id, {
			...this.#base( id, agent, seed ),
			stationary: false,
			edge,
			direction: agent.direction === - 1 ? - 1 : 1,
			distance: THREE.MathUtils.clamp( agent.progress ?? 0.5, 0, 1 ) * edge.length,
			clip: CLIP.WALK,
			position: new THREE.Vector3(),
			heading: 0,
			rng: mulberry( seed )
		} );

	}

	#base( id, agent, seed ) {

		return {
			id,
			// Stress copies share the real agent's handle, so talking to one
			// still resolves to the NPC the simulation actually knows.
			crowdId: agent.crowdId,
			type: agent.type,
			activity: agent.activity,
			npcId: null,
			instance: null,
			variant: seed % 2,
			tint: TINTS[ seed % TINTS.length ],
			frame: seed % FRAMES,
			frozen: false,
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

			this.color.set( member.tint );

			for ( const mesh of this.assets.meshesOf( member.variant ) ) {

				mesh.setInstance( slot, member.position, member.heading, member.frame, member.clip, this.color );

			}

			counts[ member.variant ] = slot + 1;

		}

		for ( let variant = 0; variant < counts.length; variant ++ ) {

			for ( const mesh of this.assets.meshesOf( variant ) ) mesh.commit( counts[ variant ] );

		}

	}

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
