import * as THREE from 'three/webgpu';

/** Eye height above a room floor when the shot is taken from inside one. */
const STAND = 0.05;

/**
 * Named camera poses for judging the look against the reference frames.
 *
 * The tuning protocol wants the same four shots re-taken after every change,
 * and eyeballing a different corner each time is how a look drifts. These are
 * derived from the world rather than typed in, so the same name lands on a
 * comparable spot in any seed: a lamp-lit stretch of street, a lit room, the
 * building the player is nearest, a vantage looking down a canyon.
 */
export class Bookmarks {

	constructor( { fixtures, rooms, networks } ) {

		this.fixtures = fixtures;
		this.rooms = rooms;
		this.networks = networks;

	}

	/** @returns { point, yaw, pitch } or null when the world has no such place. */
	pose( name ) {

		if ( name === 'street' ) return this.#street();
		if ( name === 'room' ) return this.#room();
		if ( name === 'canyon' ) return this.#canyon();

		return null;

	}

	/** Standing on the pavement under the brightest run of street fixtures. */
	#street() {

		const spot = this.#brightestAir( 0, 8 );

		if ( ! spot ) return null;

		const node = nearestWalk( this.networks, spot );

		if ( ! node ) return null;

		return {
			point: new THREE.Vector3( node.x, 0.17, node.z ),
			yaw: Math.atan2( node.x - spot.x, node.z - spot.z ) + Math.PI,
			pitch: - 0.08
		};

	}

	/** Inside the lit room with the most flux in it, looking across the room. */
	#room() {

		let best = null;

		for ( const room of this.rooms ) {

			if ( room.flux <= 0 ) continue;
			if ( ! best || room.flux / Math.max( 1, room.area ) > best.flux / Math.max( 1, best.area ) ) best = room;

		}

		if ( ! best ) return null;

		return {
			point: new THREE.Vector3( best.center.x, best.elevation + STAND, best.center.z ),
			yaw: 0,
			pitch: - 0.05
		};

	}

	/** The pavement furthest from any fixture, looking back down the street. */
	#canyon() {

		const spot = this.#brightestAir( 18, 40 );

		if ( ! spot ) return null;

		const node = nearestWalk( this.networks, spot );

		if ( ! node ) return null;

		return {
			point: new THREE.Vector3( node.x, 0.17, node.z ),
			yaw: Math.atan2( node.x - spot.x, node.z - spot.z ) + Math.PI,
			pitch: 0.22
		};

	}

	/**
	 * The fixture with the most flux around it, measured over its neighbours
	 * inside a ring, so the shot lands on a lit stretch rather than on one lamp.
	 */
	#brightestAir( inner, outer ) {

		let best = null;

		for ( const fixture of this.fixtures ) {

			let flux = 0;

			for ( const other of this.fixtures ) {

				const d = fixture.position.distanceTo( other.position );

				if ( d >= inner && d < outer ) flux += other.lumens;

			}

			if ( ! best || flux > best.flux ) best = { flux, x: fixture.position.x, z: fixture.position.z };

		}

		return best;

	}

}

function nearestWalk( networks, spot ) {

	let best = null;
	let bestDistance = Infinity;

	for ( const node of networks.walk.nodes ) {

		const d = Math.hypot( node.x - spot.x, node.z - spot.z );

		if ( d < bestDistance ) {

			bestDistance = d;
			best = node;

		}

	}

	return best;

}
