import * as THREE from 'three/webgpu';
import { measure, sample } from './Polyline.js';

const SPAWN_RADIUS = 110;
const DESPAWN_RADIUS = 140;
const REFRESH_INTERVAL = 1.5;
const STOP_MARGIN = 5;
const HEADWAY = 9;

/**
 * Cars on the connections lane graph: each drives its own lane at that lane's
 * posted speed, hands itself to one of the lane's turn connections at the end,
 * and holds at the stop line while its turn's signal is red. Lanes far from
 * the player carry nothing, so the cost tracks what is on screen.
 */
export class Traffic {

	constructor( { networks, models, signals, capacity } ) {

		this.models = models;
		this.signals = signals;
		this.capacity = capacity;
		this.cars = [];
		this.timer = REFRESH_INTERVAL;
		this.lanes = new Map();

		for ( const lane of networks.road.lanes ) {

			const line = measure( lane.path );

			if ( line.length < 6 ) continue;

			this.lanes.set( lane.id, { id: lane.id, speed: lane.speed, next: lane.next ?? [], ...line } );

		}

		this.matrix = new THREE.Matrix4();
		this.quaternion = new THREE.Quaternion();
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

		for ( const car of this.cars ) this.#drive( car, delta, daySeconds );

		this.#write();

	}

	#reconcile( player ) {

		this.cars = this.cars.filter( ( car ) => car.position.distanceTo( player ) < DESPAWN_RADIUS );

		if ( this.cars.length >= this.capacity ) return;

		const occupied = new Set( this.cars.map( ( car ) => car.lane.id ) );

		for ( const lane of this.lanes.values() ) {

			if ( this.cars.length >= this.capacity ) return;
			if ( occupied.has( lane.id ) ) continue;

			const distance = Math.hypot( lane.mid[ 0 ] - player.x, lane.mid[ 1 ] - player.z );

			if ( distance > SPAWN_RADIUS || distance < 12 ) continue;

			occupied.add( lane.id );
			this.cars.push( {
				lane,
				model: Math.floor( Math.random() * this.models.count ),
				distance: Math.random() * lane.length,
				speed: lane.speed,
				position: new THREE.Vector3(),
				heading: 0
			} );

		}

	}

	#drive( car, delta, daySeconds ) {

		const remaining = car.lane.length - car.distance;
		const turn = car.turn ?? pickTurn( car.lane );
		const held = turn?.signal && ! this.signals.green( turn.signal, daySeconds );

		car.turn = turn;

		// Ease down to the stop line, then hold there until the light frees it.
		const target = held && remaining < STOP_MARGIN ? 0 : car.lane.speed;
		car.speed += THREE.MathUtils.clamp( target - car.speed, - 12 * delta, 6 * delta );
		car.distance += Math.max( 0, car.speed ) * delta;

		if ( car.distance >= car.lane.length ) {

			const next = turn ? this.lanes.get( turn.laneId ) : null;

			if ( next ) {

				car.lane = next;
				car.distance = Math.min( HEADWAY, next.length * 0.2 );
				car.turn = null;

			} else {

				car.distance = 0;

			}

		}

		const spot = sample( car.lane, Math.min( car.distance, car.lane.length ), 1 );
		car.position.set( spot.x, 0.02, spot.z );
		car.heading = spot.heading;

	}

	#write() {

		const counts = new Array( this.models.count ).fill( 0 );

		for ( const car of this.cars ) {

			const slot = counts[ car.model ];

			if ( slot >= this.capacity ) continue;

			this.position.copy( car.position );
			this.quaternion.setFromAxisAngle( UP, car.heading );
			this.matrix.compose( this.position, this.quaternion, this.scale );
			this.models.setInstance( car.model, slot, this.matrix );
			counts[ car.model ] = slot + 1;

		}

		this.models.commit( counts );

	}

}

const UP = new THREE.Vector3( 0, 1, 0 );

function pickTurn( lane ) {

	if ( ! lane.next.length ) return null;

	const straight = lane.next.find( ( option ) => option.turn === 's' );

	return straight ?? lane.next[ Math.floor( Math.random() * lane.next.length ) ];

}
