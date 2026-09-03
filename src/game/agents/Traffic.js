import * as THREE from 'three/webgpu';
import { Rng } from '../../city/Rng.js';
import { measure, sample } from './Polyline.js';

const SPAWN_RADIUS = 110;
const DESPAWN_RADIUS = 140;
const REFRESH_INTERVAL = 1.5;
const STOP_MARGIN = 5;
/** Clear road a car keeps in front of the one ahead, bumper to bumper. */
const MIN_GAP = 7;
/** A lane shorter than this is a stub between two junctions: driven, never spawned on. */
const MIN_SPAWN_LANE = 6;
const TURN_WEIGHT = { s: 6, r: 2, l: 2, t: 1 };
const TURN_SPEED = 0.55;
/** The CC0 pack's cars: 4 to 4.8 m long, 1.8 to 2 m wide, as one box for who they touch. */
const CAR_LENGTH = 4.6;
const CAR_WIDTH = 1.9;
/** A car eases down when the player stands in its lane this far ahead of its nose, and holds this short of them. */
const YIELD_AHEAD = 10;
const YIELD_STOP = 1.5;

/**
 * Cars on the connections lane graph. A car drives its lane at that lane's
 * posted speed, picks one of the lane's turn connections with its own seeded
 * rng, holds at the stop line while that turn is red, then drives the turn's
 * own curve through the intersection onto the next lane: a corner is driven,
 * never jumped. Cars keep a following gap on the line they share, and spawn
 * into a gap wide enough for one, so two never stand in the same place.
 *
 * A car leaves the world when it is further than DESPAWN_RADIUS from the
 * player, or when the lane it is on has no turn connection at all, which is
 * the edge of the road network.
 */
export class Traffic {

	/** @param seed the world's seed; any string or number, one traffic stream per world. */
	constructor( { networks, models, signals, capacity, seed = 1 } ) {

		this.push = new THREE.Vector3();

		this.models = models;
		this.signals = signals;
		this.capacity = capacity;
		this.seed = typeof seed === 'number' ? seed >>> 0 : hash( String( seed ) );
		this.cars = [];
		this.spawned = 0;
		this.timer = REFRESH_INTERVAL;
		this.lanes = new Map();
		this.turns = new Map();

		for ( const lane of networks.road.lanes ) {

			const line = measure( lane.path3, `road lane ${lane.id}.path3` );

			if ( ! ( line.length > 0 ) ) continue;

			this.lanes.set( lane.id, { id: lane.id, speed: lane.speed, next: lane.next ?? [], ...line } );

		}

		this.matrix = new THREE.Matrix4();
		this.quaternion = new THREE.Quaternion();
		this.rotation = new THREE.Euler( 0, 0, 0, 'YXZ' );
		this.position = new THREE.Vector3();
		this.scale = new THREE.Vector3( 1, 1, 1 );

	}

	get count() {

		return this.cars.length;

	}

	update( delta, player, daySeconds ) {

		this.timer += delta;

		if ( this.timer >= REFRESH_INTERVAL ) {

			this.timer = 0;
			this.#reconcile( player );

		}

		const traffic = this.#byLine();

		for ( const car of this.cars ) this.#drive( car, delta, daySeconds, traffic, player );

		this.cars = this.cars.filter( ( car ) => ! car.gone );

		this.#write();

	}

	/** Cars on each line, in travel order, so each one can see the one ahead. */
	#byLine() {

		const lines = new Map();

		for ( const car of this.cars ) {

			const id = lineId( car );

			if ( ! lines.has( id ) ) lines.set( id, [] );

			lines.get( id ).push( car );

		}

		for ( const cars of lines.values() ) cars.sort( ( a, b ) => a.distance - b.distance );

		return lines;

	}

	#reconcile( player ) {

		this.cars = this.cars.filter( ( car ) => car.position.distanceTo( player ) < DESPAWN_RADIUS );

		if ( this.cars.length >= this.capacity ) return;

		const taken = new Map();

		for ( const car of this.cars ) {

			if ( car.via ) continue;

			if ( ! taken.has( car.lane.id ) ) taken.set( car.lane.id, [] );

			taken.get( car.lane.id ).push( car.distance );

		}

		for ( const lane of this.lanes.values() ) {

			if ( this.cars.length >= this.capacity ) return;
			if ( lane.length < MIN_SPAWN_LANE ) continue;

			const distance = Math.hypot( lane.mid[ 0 ] - player.x, lane.mid[ 2 ] - player.z );

			if ( distance > SPAWN_RADIUS || distance < 12 ) continue;

			const spawnIndex = this.spawned ++;
			const rng = new Rng( mix( this.seed, spawnIndex ) );
			const at = freeSlot( lane.length, taken.get( lane.id ) ?? [], rng );

			if ( at === null ) continue;

			if ( ! taken.has( lane.id ) ) taken.set( lane.id, [] );

			taken.get( lane.id ).push( at );

			this.cars.push( {
				id: `car:${spawnIndex}`,
				rng,
				lane,
				via: null,
				turn: null,
				model: Math.floor( rng.next() * this.models.count ),
				distance: at,
				speed: lane.speed,
				gone: false,
				position: new THREE.Vector3(),
				heading: 0,
				pitch: 0
			} );

		}

	}

	#drive( car, delta, daySeconds, traffic, player ) {

		if ( ! car.via && ! car.turn ) car.turn = pickTurn( car.lane, car.rng );

		const line = car.via ?? car.lane;
		const limit = car.via ? car.lane.speed * TURN_SPEED : car.lane.speed;
		const remaining = line.length - car.distance;

		// Ease down to the stop line, then hold there until the light frees it.
		const held = ! car.via && car.turn?.signal && ! this.signals.green( car.turn.signal, daySeconds );
		let target = held && remaining < STOP_MARGIN ? 0 : limit;

		const gap = gapAhead( car, traffic );

		if ( gap < MIN_GAP ) target = 0;
		else if ( gap < MIN_GAP * 2 ) target = Math.min( target, limit * ( gap - MIN_GAP ) / MIN_GAP );

		// Somebody standing in the lane ahead: ease down to them and hold short.
		const ahead = this.#ahead( car, player );

		if ( ahead !== null ) target = ahead < YIELD_STOP ? 0 : Math.min( target, limit * ( ahead - YIELD_STOP ) / YIELD_AHEAD );

		car.speed += THREE.MathUtils.clamp( target - car.speed, - 12 * delta, 6 * delta );
		car.distance += Math.max( 0, car.speed ) * delta;

		if ( car.distance >= line.length ) this.#advance( car, car.distance - line.length );

		const spot = sample( car.via ?? car.lane, Math.min( car.distance, ( car.via ?? car.lane ).length ), 1 );
		car.position.set( spot.x, spot.y + 0.02, spot.z );
		car.heading = spot.heading;
		car.pitch = spot.pitch;

	}

	/**
	 * How far ahead of this car's nose the player stands inside its lane
	 * corridor, or null when they are not in its way.
	 */
	#ahead( car, player ) {

		if ( Math.abs( player.y - car.position.y ) > 2 ) return null;

		const local = toCar( car, player );
		const ahead = local.along - CAR_LENGTH / 2;

		if ( ahead < 0 || ahead > YIELD_AHEAD + YIELD_STOP ) return null;
		if ( Math.abs( local.lateral ) > CAR_WIDTH / 2 + PLAYER_CLEARANCE ) return null;

		return ahead;

	}

	/**
	 * How far the player has to move to stop standing inside a car: the same
	 * rule as the crowd's, over the car's box instead of a person's circle,
	 * out through whichever side is nearer. The result is reused; copy it if
	 * it has to outlive the call.
	 *
	 * @param point the player's feet
	 * @param clearance the player's own radius
	 */
	pushback( point, clearance ) {

		this.push.set( 0, 0, 0 );

		for ( const car of this.cars ) {

			if ( Math.abs( point.y - car.position.y ) > 2 ) continue;

			const local = toCar( car, point );
			const alongRoom = CAR_LENGTH / 2 + clearance - Math.abs( local.along );
			const lateralRoom = CAR_WIDTH / 2 + clearance - Math.abs( local.lateral );

			if ( alongRoom <= 0 || lateralRoom <= 0 ) continue;

			const sin = Math.sin( car.heading );
			const cos = Math.cos( car.heading );

			if ( lateralRoom < alongRoom ) {

				const side = local.lateral < 0 ? - 1 : 1;
				this.push.x += cos * side * lateralRoom;
				this.push.z -= sin * side * lateralRoom;

			} else {

				const end = local.along < 0 ? - 1 : 1;
				this.push.x += sin * end * alongRoom;
				this.push.z += cos * end * alongRoom;

			}

		}

		return this.push;

	}

	/** End of the lane: onto the turn's curve. End of the curve: onto the next lane. */
	#advance( car, carry ) {

		if ( car.via ) {

			const next = this.lanes.get( car.turn.laneId );

			if ( ! next ) {

				car.gone = true;
				return;

			}

			car.lane = next;
			car.via = null;
			car.turn = pickTurn( next, car.rng );
			car.distance = Math.min( carry, next.length );

			return;

		}

		if ( ! car.turn ) {

			car.gone = true;
			return;

		}

		car.via = this.#via( car.lane, car.turn );
		car.distance = Math.min( carry, car.via.length );

	}

	/** The measured curve through one intersection, kept for every car that takes it. */
	#via( lane, turn ) {

		const id = `${lane.id}>${turn.laneId}`;

		if ( ! this.turns.has( id ) ) {

			this.turns.set( id, { id, ...measure( turn.via3, `turn ${id}.via3` ) } );

		}

		return this.turns.get( id );

	}

	#write() {

		const counts = new Array( this.models.count ).fill( 0 );

		for ( const car of this.cars ) {

			const slot = counts[ car.model ];

			if ( slot >= this.capacity ) continue;

			this.position.copy( car.position );
			this.rotation.set( - car.pitch, car.heading, 0, 'YXZ' );
			this.quaternion.setFromEuler( this.rotation );
			this.matrix.compose( this.position, this.quaternion, this.scale );
			this.models.setInstance( car.model, slot, this.matrix );
			counts[ car.model ] = slot + 1;

		}

		this.models.commit( counts );

	}

}

/** Room a person needs beside a car's side to count as out of its lane. */
const PLAYER_CLEARANCE = 0.6;

/** A world point in a car's frame: along its heading (forward positive) and across it (left positive). */
function toCar( car, point ) {

	const dx = point.x - car.position.x;
	const dz = point.z - car.position.z;
	const sin = Math.sin( car.heading );
	const cos = Math.cos( car.heading );

	return { along: dx * sin + dz * cos, lateral: dx * cos - dz * sin };

}

/** The line a car is travelling: its lane, or the curve it is crossing on. */
function lineId( car ) {

	return car.via ? car.via.id : car.lane.id;

}

/** Metres of clear road in front, or Infinity when nothing shares the line. */
function gapAhead( car, traffic ) {

	const queue = traffic.get( lineId( car ) );

	if ( ! queue ) return Infinity;

	const index = queue.indexOf( car );
	const ahead = queue[ index + 1 ];

	return ahead ? ahead.distance - car.distance : Infinity;

}

/**
 * The turn this car takes out of a lane: straight three times as often as a
 * left or a right, drawn from the car's own rng so the same car always turns
 * the same way. A lane with no turn connections is the end of the network.
 */
function pickTurn( lane, rng ) {

	if ( ! lane.next.length ) return null;

	return lane.next[ rng.pickWeighted( lane.next.map( ( option ) => TURN_WEIGHT[ option.turn ] ?? 1 ) ) ];

}

/**
 * A spot on the lane at least MIN_GAP clear of every car already on it, or
 * null when the lane has no room. Widest gap first, so cars spread out.
 */
function freeSlot( length, occupied, rng ) {

	const edges = [ - MIN_GAP, ...[ ...occupied ].sort( ( a, b ) => a - b ), length + MIN_GAP ];
	let best = { width: 0, start: 0 };

	for ( let i = 0; i < edges.length - 1; i ++ ) {

		const width = edges[ i + 1 ] - edges[ i ];

		if ( width > best.width ) best = { width, start: edges[ i ] };

	}

	if ( best.width < MIN_GAP * 2 ) return null;

	const low = Math.max( 0, best.start + MIN_GAP );
	const high = Math.min( length, best.start + best.width - MIN_GAP );

	return high <= low ? null : rng.range( low, high );

}

/** Two integers into one seed, so every car's rng is its own. */
function mix( seed, index ) {

	return ( Math.imul( seed ^ ( index + 0x9e3779b9 ), 0x85ebca6b ) >>> 0 );

}

function hash( text ) {

	let h = 2166136261;

	for ( let i = 0; i < text.length; i ++ ) h = Math.imul( h ^ text.charCodeAt( i ), 16777619 );

	return h >>> 0;

}
