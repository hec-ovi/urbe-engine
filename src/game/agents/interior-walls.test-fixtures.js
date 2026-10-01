import { expect } from 'vitest';

/**
 * Checks of a walk against the rooms and doors a building draws: a level
 * stretch keeps to rooms and passes from one to the next, or in from the
 * street, only through a door or an open front between the two.
 */

/** How finely a walked segment is checked, metres. */
const SAMPLE = 0.05;

/** Just inside the building's street door, on the ground floor. */
export function streetDoor( interior ) {

	const ground = roomsOf( interior, 0 );
	for ( const room of ground ) {

		const door = room.doors?.find( ( candidate ) => candidate.to === 'outside' );
		if ( ! door ) continue;
		const [ cx, cz ] = centre( room.polygon );
		const away = Math.hypot( cx - door.position[ 0 ], cz - door.position[ 1 ] );
		const point = [ door.position[ 0 ] + ( cx - door.position[ 0 ] ) / away * 0.6, 0, door.position[ 1 ] + ( cz - door.position[ 1 ] ) / away * 0.6 ];
		return point.map( ( value ) => Math.round( value * 100 ) / 100 );

	}
	throw new Error( 'no street door' );

}

/**
 * Every level stretch of the path lies in the rooms of its floor and passes
 * from one room to the next only through a door (or open front) between the two.
 */
export function walls( interior, path3, label ) {

	const levels = new Map( interior.building.floors.map( ( floor ) => [ floor.index, floor.elevation ] ) );
	const floorAt = ( y ) => [ ...levels ].find( ( [ , elevation ] ) => Math.abs( elevation - y ) < 0.01 )?.[ 0 ];
	for ( let index = 1; index < path3.length; index ++ ) {

		const from = path3[ index - 1 ];
		const to = path3[ index ];
		if ( Math.abs( to[ 1 ] - from[ 1 ] ) > 1e-6 ) continue;
		const floor = floorAt( from[ 1 ] );
		if ( floor === undefined ) continue;
		const rooms = roomsOf( interior, floor );
		const bounds = boundsOf( rooms );
		const length = Math.hypot( to[ 0 ] - from[ 0 ], to[ 2 ] - from[ 2 ] );
		const steps = Math.max( 1, Math.ceil( length / SAMPLE ) );
		let last = null;
		let lastPoint = null;
		let outside = 0;
		for ( let step = 0; step <= steps; step ++ ) {

			const t = step / steps;
			const point = [ from[ 0 ] + ( to[ 0 ] - from[ 0 ] ) * t, from[ 2 ] + ( to[ 2 ] - from[ 2 ] ) * t ];
			const room = roomAt( rooms, point ) ?? ( within( bounds, point ) ? null : 'outside' );
			if ( room === null ) {

				outside ++;
				expect( outside * length / steps, `${label}: out of every room at ${point}` ).toBeLessThan( 0.3 );
				continue;

			}
			outside = 0;
			if ( last !== null && room !== last ) {

				const crossing = [ ( lastPoint[ 0 ] + point[ 0 ] ) / 2, ( lastPoint[ 1 ] + point[ 1 ] ) / 2 ];
				const doors = between( rooms, last, room );
				const through = doors.some( ( door ) => Math.hypot( crossing[ 0 ] - door.position[ 0 ], crossing[ 1 ] - door.position[ 1 ] ) <= door.width / 2 + 0.1 );
				expect( through, `${label}: from ${last} into ${room} at ${crossing} on floor ${floor}, doors ${JSON.stringify( doors.map( ( door ) => door.position ) )}` ).toBe( true );

			}
			last = room;
			lastPoint = point;

		}

	}

}

export function roomsOf( interior, index ) {

	const floor = interior.building.floors.find( ( entry ) => entry.index === index );
	return interior.layouts[ floor.layout ].floor.rooms;

}

/** The id of the room holding `point`, or within `slack` of one; null when none does. */
export function roomAt( rooms, point, slack = 0 ) {

	const [ x, z ] = point.length === 3 ? [ point[ 0 ], point[ 2 ] ] : point;
	const hit = rooms.find( ( room ) => contains( room.polygon, x, z ) )
		?? ( slack ? rooms.find( ( room ) => edgeDistance( room.polygon, x, z ) <= slack ) : null );
	return hit?.id ?? null;

}

/** The doors between two rooms, published on either side. */
function between( rooms, a, b ) {

	const doorsOf = ( id, to ) => ( rooms.find( ( room ) => room.id === id )?.doors ?? [] ).filter( ( door ) => door.to === to );
	return [ ...doorsOf( a, b ), ...doorsOf( b, a ) ];

}

function contains( polygon, x, z ) {

	let inside = false;
	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i ++ ) {

		const [ xi, zi ] = polygon[ i ];
		const [ xj, zj ] = polygon[ j ];
		if ( ( zi > z ) !== ( zj > z ) && x < ( xj - xi ) * ( z - zi ) / ( zj - zi ) + xi ) inside = ! inside;

	}
	return inside;

}

function edgeDistance( polygon, x, z ) {

	let best = Infinity;
	for ( let i = 0, j = polygon.length - 1; i < polygon.length; j = i ++ ) {

		const [ ax, az ] = polygon[ j ];
		const [ bx, bz ] = polygon[ i ];
		const length = ( bx - ax ) ** 2 + ( bz - az ) ** 2;
		const t = length ? Math.max( 0, Math.min( 1, ( ( x - ax ) * ( bx - ax ) + ( z - az ) * ( bz - az ) ) / length ) ) : 0;
		best = Math.min( best, Math.hypot( x - ( ax + t * ( bx - ax ) ), z - ( az + t * ( bz - az ) ) ) );

	}
	return best;

}

function centre( polygon ) {

	return [ 0, 1 ].map( ( axis ) => polygon.reduce( ( sum, point ) => sum + point[ axis ], 0 ) / polygon.length );

}

/** The box the rooms of a floor fill: beyond it is the street, inside it a wall where no room is. */
function boundsOf( rooms ) {

	const points = rooms.flatMap( ( room ) => room.polygon );
	return [ 0, 1 ].map( ( axis ) => [ Math.min( ...points.map( ( point ) => point[ axis ] ) ), Math.max( ...points.map( ( point ) => point[ axis ] ) ) ] );

}

function within( bounds, point ) {

	return bounds.every( ( [ low, high ], axis ) => point[ axis ] >= low && point[ axis ] <= high );

}
