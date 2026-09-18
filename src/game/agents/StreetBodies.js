import { FALL_SETTLE_SECONDS } from '../physics/Ragdoll.js';

/** Grid cell in metres. A cell holds the handful of people standing in it. */
const CELL = 2;

/**
 * Who is out on the street right now, for whoever has to keep out of them.
 * The crowd publishes every body it moved this frame, walkers read it to stay
 * out of each other, and traffic reads it to stop for whoever is in the road.
 *
 * It also holds the people a car has knocked down: the crowd enters one when
 * its rig goes dynamic, the fallen rig reports when the body has come to rest,
 * and the crowd takes it back then or when its time is up. One instance is
 * shared by the crowd, the fallen rig and the traffic; a test hands its own
 * to each of them.
 */
export class StreetBodies {

	constructor() {

		this.cells = new Map();
		this.down = new Map();

	}

	/** Starts a frame: the grid is rebuilt from the bodies the crowd moved. */
	open() {

		this.cells.clear();

	}

	place( member ) {

		const key = cell( member.position );
		const here = this.cells.get( key );

		if ( here ) here.push( member );
		else this.cells.set( key, [ member ] );

	}

	/**
	 * Every body inside a circle on the ground.
	 * @param visit called with the body and its distance from the centre
	 */
	forEachNear( position, radius, visit ) {

		const low = cellIndex( position.x - radius );
		const high = cellIndex( position.x + radius );
		const back = cellIndex( position.z - radius );
		const front = cellIndex( position.z + radius );

		for ( let x = low; x <= high; x ++ ) {

			for ( let z = back; z <= front; z ++ ) {

				for ( const member of this.cells.get( `${x}:${z}` ) ?? [] ) {

					const distance = Math.hypot( member.position.x - position.x, member.position.z - position.z );

					if ( distance <= radius ) visit( member, distance );

				}

			}

		}

	}

	/** One crowd body goes to the ground. */
	enter( member ) {

		this.down.set( member.id, { member, seconds: 0, rig: false, resting: false } );

	}

	/** The full articulated body now drives this person. */
	take( id ) {

		const record = this.down.get( id );
		if ( record ) record.rig = true;

	}

	/** The rig is gone and the body lies where it stopped. */
	rest( id ) {

		const record = this.down.get( id );
		if ( record ) record.resting = true;

	}

	leave( id ) {

		this.down.delete( id );

	}

	has( id ) {

		return this.down.has( id );

	}

	advance( seconds ) {

		for ( const record of this.down.values() ) record.seconds += seconds;

	}

	/** Everyone whose fall is over: the body has stopped, or its time is up. */
	done() {

		return [ ...this.down.values() ]
			.filter( ( record ) => record.resting || ( ! record.rig && record.seconds >= FALL_SETTLE_SECONDS ) );

	}

}

/** The street the crowd, the fallen rig and the traffic all mean. */
export const streetBodies = new StreetBodies();

function cell( position ) {

	return `${cellIndex( position.x )}:${cellIndex( position.z )}`;

}

function cellIndex( value ) {

	return Math.floor( value / CELL );

}
