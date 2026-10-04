import * as THREE from 'three/webgpu';

/** How far under the last ground the player stood on a fall has to reach before the guard looks below it. */
export const FALL_DROP = 3;
/**
 * Feet this close over the safety floor are out of the world: the floor stands
 * 2 m under the lowest geometry the city authors (../ground/SafetyGround.js).
 */
const OUT_OF_WORLD = 1;

/**
 * The last line under the player: a body that has fallen out of the world is
 * put back where it last stood on the street.
 *
 * Nothing in the city should let the player through it, and the safety floor
 * catches whatever does, under the street and out of play. So once a step,
 * after the body moved, the guard reads its feet. While they stand on something
 * it only keeps where they stand, and the street point among those. When they
 * have dropped more than `drop` under the last ground they stood on and a ray
 * from them down to the safety floor meets nothing solid, or when they are down
 * on that floor, it answers the street point for the game to stand the player
 * on again. A fall onto the street from a roof meets the street and runs its
 * course; a ride (a lift car, a train) carries the body and ends where it puts
 * it down, which is a point to come back to as a placement is.
 *
 * Nothing is allocated per step: the feet are read off the body's own
 * position, the ray is one object moved each time it is cast, and it is cast
 * only during a fall deeper than `drop`.
 */
export class FallGuard {

	/**
	 * @param physics the game's Physics
	 * @param body the PlayerBody
	 * @param floor the safety floor's elevation
	 */
	constructor( { physics, body, floor, drop = FALL_DROP } ) {

		this.physics = physics;
		this.body = body;
		this.floor = floor;
		this.drop = drop;
		/** Where the player last stood on the street, or was last put. */
		this.safe = new THREE.Vector3();
		/** The height of the last ground the feet stood on. */
		this.ground = 0;
		this.carried = body.carried;
		this.ray = new physics.rapier.Ray( { x: 0, y: 0, z: 0 }, { x: 0, y: - 1, z: 0 } );
		this.placed( body.position.x, body.position.y - body.centreOffset, body.position.z );

	}

	/** The player was put at these feet on purpose: the point to come back to, and the ground a fall is measured from. */
	placed( x, y, z ) {

		this.safe.set( x, y, z );
		this.ground = y;

	}

	/**
	 * One step's watch, after the body moved.
	 * @param street whether the player stands outdoors, so that where they stand is a street point
	 * @returns the feet to stand the player at again, or null while they are in the world
	 */
	update( street = true ) {

		const { body } = this;

		if ( body.carried ) {

			this.carried = true;
			return null;

		}

		const { x, z } = body.position;
		const y = body.position.y - body.centreOffset;

		if ( this.carried ) {

			// A ride ends at an authoritative safe point.
			this.carried = false;
			this.placed( x, y, z );
			return null;

		}

		const out = y < this.floor + OUT_OF_WORLD;

		if ( body.grounded && ! out ) {

			this.ground = y;
			if ( street ) this.safe.set( x, y, z );
			return null;

		}
		if ( ! out && ( y > this.ground - this.drop || this.#solidUnder( x, y, z ) ) ) return null;

		this.ground = this.safe.y;
		return this.safe;

	}

	/** Whether anything solid stands under the feet before the safety floor. */
	#solidUnder( x, y, z ) {

		const { rapier, world } = this.physics;
		const { origin } = this.ray;
		origin.x = x;
		origin.y = y;
		origin.z = z;

		return world.castRay(
			this.ray, y - this.floor - OUT_OF_WORLD, true,
			rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.body.collider
		) !== null;

	}

}
