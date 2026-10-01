/** A door within this far of a gate's point, across, on its floor, is the gate's door. */
const DOOR_REACH = 1.6;
const DOOR_RISE = 2;
/** A door counts as open for a walker once its leaves are this far apart. */
const DOOR_OPEN = 0.9;
/** Seconds after the last walker asked that a door a walker opened closes again. */
const CLOSE_AFTER = 2.5;
/** A lift's doors let a walker in or out once they are this open. */
const LIFT_OPEN = 0.95;
/** A car stands at a landing within this of its elevation. */
const AT_LANDING = 0.05;

/**
 * The doors and lifts a walker passes, as NpcContinuity's `ways`, over the
 * game's own door leaves and lift shafts: a walker's door gate sets the door
 * it names wanted open, the same field the player's E sets, so the leaves
 * slide and their colliders follow, and closes it again a few seconds after
 * the last walker went through, unless the player had opened it; a walker's
 * lift gate calls the car to its landing, boards once the doors stand open,
 * sends the car to its floor, rides at the car's height and steps out once
 * the doors open there. A door or lift that is not loaded answers null (no
 * such way here), and the walker walks the way as drawn, out of sight.
 */
export class Passage {

	/**
	 * @param doors returns the door records loaded now: street doors and apartment doors,
	 *   each `{ parcelId, center, open, wanted }`
	 * @param elevators the game's Elevators: `byBuilding` parcelId to shafts `{ liftId, stops, at, moving, called, target, selected, press, stopAt }`
	 * @param seconds the clock doors close by, in seconds
	 */
	constructor( { doors = () => [], elevators = null, seconds = () => performance.now() / 1000 } = {} ) {

		this.doors = doors;
		this.elevators = elevators;
		this.seconds = seconds;
		/** Doors walkers opened, with when one last asked. */
		this.opened = new Map();

	}

	/** Asks the door a gate names open; true once the walker may go through, or when no such door is loaded. */
	pass( npcId, gate ) {

		const door = this.#door( gate );
		if ( ! door ) return true;
		const mine = this.opened.get( door );
		// A door the player opened stays the player's: walkers only borrow it.
		if ( ! mine && door.wanted > 0.5 ) return door.open >= DOOR_OPEN;
		door.wanted = 1;
		this.opened.set( door, this.seconds() );
		return door.open >= DOOR_OPEN;

	}

	/**
	 * Runs one walker's lift gate: `call` answers `board` once the car stands
	 * open at the gate's landing, else calls it and answers `wait`; `ride`
	 * sends the car on to the gate's floor and answers `{ y }`, the car's
	 * height, until it stands open there, `alight`; `done` answers `done`.
	 * Null when the gate's shaft or either landing is not loaded.
	 */
	ride( npcId, gate, stage ) {

		const shaft = this.elevators?.byBuilding?.get( gate.parcelId )?.find( ( candidate ) => candidate.liftId === gate.shaft );
		const from = shaft?.stopAt( gate.fromFloor );
		const to = shaft?.stopAt( gate.toFloor );
		if ( ! shaft || ! from || ! to ) return null;
		const standing = ( stop ) => ! shaft.moving && Math.abs( shaft.at - stop.elevation ) < AT_LANDING;
		if ( stage === 'call' ) {

			if ( standing( from ) && from.open >= LIFT_OPEN ) return 'board';
			// Called once: the car comes, or the call waits behind its trip.
			if ( ! ( shaft.called && Math.abs( shaft.target - from.elevation ) < AT_LANDING ) ) shaft.press( { inside: false, stop: from } );
			return 'wait';

		}
		if ( stage === 'ride' ) {

			if ( standing( to ) ) return to.open >= LIFT_OPEN ? 'alight' : { y: shaft.at };
			if ( ! shaft.moving ) {

				// In the car with its doors open somewhere else: the walker presses its floor.
				shaft.selected = shaft.stops.indexOf( to );
				shaft.press( { inside: true } );

			}
			return { y: shaft.at };

		}
		return 'done';

	}

	/** Closes the doors walkers opened once nobody has asked for them for CLOSE_AFTER seconds. */
	update() {

		const now = this.seconds();
		for ( const [ door, at ] of this.opened ) {

			if ( now - at < CLOSE_AFTER ) continue;
			door.wanted = 0;
			this.opened.delete( door );

		}

	}

	/** The loaded door a gate names: of its building, nearest its point, on its floor. */
	#door( gate ) {

		let best = null;
		let nearest = DOOR_REACH;
		for ( const door of this.doors() ) {

			if ( door.parcelId !== gate.parcelId || ! door.center ) continue;
			if ( Math.abs( door.center.y - gate.position[ 1 ] ) > DOOR_RISE ) continue;
			const across = Math.hypot( door.center.x - gate.position[ 0 ], door.center.z - gate.position[ 2 ] );
			if ( across < nearest ) {

				best = door;
				nearest = across;

			}

		}
		return best;

	}

}
