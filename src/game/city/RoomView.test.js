import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { RoomView } from './RoomView.js';

/** A room as RoomView sees it: an extent on the ground and a height band. */
function room( id, bounds ) {

	return {
		id,
		bounds,
		center: new THREE.Vector3( ( bounds.x0 + bounds.x1 ) / 2, 2.2, ( bounds.z0 + bounds.z1 ) / 2 ),
		visible: false
	};

}

describe( 'RoomView', () => {

	it( 'keeps a room in view by its own extent, however far its middle is', () => {

		// A sales floor 60 m across: standing in its corner is 40 m from the
		// anchor in the middle of it and no distance at all from the room.
		const hall = room( 'hall', { x0: 0, z0: 0, x1: 60, z1: 60 } );
		const next = room( 'next', { x0: 200, z0: 200, x1: 210, z1: 210 } );
		const view = new RoomView( [ hall, next ], 32 );

		const visible = view.update( new THREE.Vector3( 2, 1.7, 2 ), 1 );

		expect( hall.center.distanceTo( new THREE.Vector3( 2, 1.7, 2 ) ) ).toBeGreaterThan( 32 );
		expect( visible ).toEqual( [ hall ] );
		expect( hall.visible ).toBe( true );
		expect( next.visible ).toBe( false );

		// And the floor above is behind a slab, whatever the ground says.
		view.update( new THREE.Vector3( 2, 12, 2 ), 1 );
		expect( hall.visible ).toBe( false );

	} );

} );
