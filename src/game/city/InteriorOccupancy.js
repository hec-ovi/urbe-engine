import * as THREE from 'three/webgpu';
import { roomFootprintContains } from '../../../../interior/src/core/room-footprint.ts';

/** Stable safe standing spots, inside published rooms and clear of furniture. */
export function interiorOccupancy( interior, inside ) {

	const floor = interior?.building.floors.find( entry => entry.index === 0 );
	const layout = floor && interior.layouts[ floor.layout ];
	if ( ! layout ) return {};
	const rooms = layout.floor.rooms;
	const contains = point => rooms.some( room => roomFootprintContains( room, [ point.x, point.z ] ) );
	const lobby = [];
	// Search near the authored entrance, keeping a whole body inside the room.
	for ( let x = - 6; x <= 6; x ++ ) for ( let z = - 6; z <= 6; z ++ ) {

		const point = new THREE.Vector3( inside.x + x * 0.8, floor.elevation, inside.z + z * 0.8 );
		if ( ! [ [ 0, 0 ], [ 0.4, 0 ], [ - 0.4, 0 ], [ 0, 0.4 ], [ 0, - 0.4 ] ].every( ( [ dx, dz ] ) =>
			contains( { x: point.x + dx, z: point.z + dz } ) ) ) continue;
		const occupied = layout.placements.some( placement => {

			if ( ! placement.prop && ! placement.module?.startsWith( 'fit-' ) ) return false;
			return Math.hypot( point.x - placement.position[ 0 ], point.z - placement.position[ 2 ] ) < 1.1;

		} );
		if ( ! occupied ) lobby.push( point );

	}
	lobby.sort( ( a, b ) => a.distanceToSquared( inside ) - b.distanceToSquared( inside ) || a.x - b.x || a.z - b.z );
	return { contains, lobby };

}
