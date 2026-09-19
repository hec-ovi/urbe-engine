const RESORT_INTERVAL = 0.2;
/** Vertical visibility band for streamed playable rooms around the player. */
const FLOOR_BAND = 4.5;

/**
 * Which interior rooms are worth lighting, nearest first.
 *
 * A city of a thousand rooms cannot light them all, and it never needs to:
 * past a block a room is behind opaque walls and haze, and a floor above the
 * one being stood on is behind a slab. So a room counts as in view only while
 * it is within reach and on the level the player is on, and the order it comes
 * back in is the order the light slots are handed out, so the room being stood
 * in is always the one lit by its own fixtures.
 *
 * Reach is measured to the room's own extent, never to a single anchor in the
 * middle of it: a sales floor is 26 m across and a mall floor 53, so a test
 * against an anchor drops the room the player is standing in the moment they
 * walk away from its middle, and with it that room's light slot, its air and
 * its exposure.
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

			const d = groundGap( room.bounds, position );

			room.visible = d < this.radiusSq
				&& Math.abs( room.center.y - position.y ) < FLOOR_BAND;

			if ( room.visible ) near.push( { room, d } );

		}

		near.sort( ( a, b ) => a.d - b.d );
		this.visible = near.map( ( entry ) => entry.room );

		return this.visible;

	}

}

/** Squared distance from a point to a room's ground extent; zero inside it. */
function groundGap( bounds, position ) {

	if ( ! bounds ) return Infinity;

	const dx = Math.max( bounds.x0 - position.x, 0, position.x - bounds.x1 );
	const dz = Math.max( bounds.z0 - position.z, 0, position.z - bounds.z1 );

	return dx * dx + dz * dz;

}
