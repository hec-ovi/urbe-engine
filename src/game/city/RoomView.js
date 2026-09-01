const RESORT_INTERVAL = 0.2;
/**
 * A floor other than the one being stood on is behind a slab. From the street
 * that means the ground floor through its windows and nothing above it, which
 * is what the lit window panes are for.
 */
const FLOOR_BAND = 4.5;

/**
 * Which interior rooms are worth drawing, nearest first.
 *
 * A city of a thousand rooms cannot draw them all, and it never needs to: past
 * a block a room is behind opaque walls and haze, and a floor above the one
 * being stood on is behind a slab. So a room is shown only while it is within
 * reach and on the level the player is on, and the order it comes back in is
 * the order the light slots are handed out, so the room being stood in is
 * always the one lit by its own fixtures.
 */
export class RoomView {

	constructor( rooms, radius ) {

		this.rooms = rooms;
		this.radiusSq = radius * radius;
		this.visible = [];
		this.timer = RESORT_INTERVAL;

	}

	/**
	 * The rooms currently in memory. Interiors stream, so the set changes as
	 * the player walks; a new building's rooms are sorted in on the next pass.
	 */
	setRooms( rooms ) {

		this.rooms = rooms;
		this.timer = RESORT_INTERVAL;

	}

	/** @returns the rooms in range, nearest first. */
	update( position, delta ) {

		this.timer += delta;

		if ( this.timer < RESORT_INTERVAL ) return this.visible;

		this.timer = 0;

		const near = [];

		for ( const room of this.rooms ) {

			const d = room.center.distanceToSquared( position );

			room.group.visible = d < this.radiusSq
				&& Math.abs( room.center.y - position.y ) < FLOOR_BAND;

			if ( room.group.visible ) near.push( { room, d } );

		}

		near.sort( ( a, b ) => a.d - b.d );
		this.visible = near.map( ( entry ) => entry.room );

		return this.visible;

	}

}
