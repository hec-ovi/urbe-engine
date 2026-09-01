import { describe, expect, it } from 'vitest';
import { floorAt, InteriorStream } from './InteriorStream.js';
import { outlinesOf, partition, OUTSIDE_FLOORS } from './InteriorRooms.js';
import * as THREE from 'three/webgpu';

/** Four floors of a real building: a basement, a tall lobby, two storeys. */
const bands = [
	{ floor: - 1, elevation: - 3.2, height: 3.2 },
	{ floor: 0, elevation: 0, height: 4 },
	{ floor: 1, elevation: 4, height: 3.4 },
	{ floor: 2, elevation: 7.4, height: 3.4 },
	{ floor: OUTSIDE_FLOORS, elevation: 0, height: 0 }
];

/**
 * Streaming a tower a floor at a time only works if the floor the player is on
 * is picked right: pick the wrong one and they fall through the slab they are
 * standing on, or the room they walked into is not in the scene.
 */
describe( 'floorAt', () => {

	it( 'is the floor whose slab-to-slab band holds the feet', () => {

		expect( floorAt( bands, 0.05 ) ).toBe( 0 );
		expect( floorAt( bands, 3.9 ) ).toBe( 0 );
		expect( floorAt( bands, 4.1 ) ).toBe( 1 );
		expect( floorAt( bands, 8 ) ).toBe( 2 );
		expect( floorAt( bands, - 1 ) ).toBe( - 1 );

	} );

	it( 'is the nearest floor from outside the building, which is where the player usually is', () => {

		// On the pavement, a few centimetres above the lobby slab.
		expect( floorAt( bands, 0.12 ) ).toBe( 0 );
		// On a roof terrace over the top floor.
		expect( floorAt( bands, 40 ) ).toBe( 2 );

	} );

	it( 'never answers with the band that belongs to no floor', () => {

		expect( floorAt( bands, 1000 ) ).not.toBe( OUTSIDE_FLOORS );

	} );

} );

/** One furnished floor: a patch of carpet inside the published room. */
const floors = [ {
	floor: 0, elevation: 0, height: 3,
	rooms: [ { id: 'r0', kind: 'living', polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] } ],
	lights: []
} ];
const carpet = {
	key: 'cyberpunk/carpet/mid',
	position: new Float32Array( [ 1, 0, 1, 3, 0, 1, 1, 0, 3 ] ),
	normal: new Float32Array( 9 ),
	uv: new Float32Array( 6 )
};

/** What the worker posts for that floor: the cut, run in-process. */
function posted() {

	return { cut: partition( [ carpet ], outlinesOf( floors ) ), bytes: 0, cost: {} };

}

/** A stream with one building registered 3 m away, and the worker stubbed. */
function stream( cut ) {

	const roomLights = {
		dim: { room: null },
		materialFor: ( binding, key ) => new THREE.MeshBasicMaterial( { name: key } )
	};
	const stream = new InteriorStream( {
		factory: { tint: async () => null }, roomLights, haze: null, elevators: null
	} );
	stream.worker = { cut, dispose: () => { stream.workerDisposed = true; } };
	stream.register(
		new Map( [ [ 'p0', { glbUrl: '/out/p0/interior/building.glb', floors } ] ] ),
		new Map( [ [ 'p0', { x: 2, z: 2 } ] ] )
	);

	return stream;

}

const settle = async ( stream ) => {

	while ( stream.loading ) await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

};

/**
 * A furnished interior takes many frames to arrive, and the streamer is
 * updated on every one of them; a building whose load is in flight must never
 * break the frame that asked for it.
 */
describe( 'InteriorStream.update', () => {

	it( 'keeps ticking while a building is still loading', () => {

		const feet = { x: 0, y: 0, z: 0 };
		const loading = stream( () => new Promise( () => {} ) );

		loading.update( feet );

		expect( () => loading.update( feet ) ).not.toThrow();
		expect( loading.liveInteriors ).toBe( 1 );

	} );

	it( 'hands over every room already wearing a material', async () => {

		const landed = stream( async () => posted() );

		landed.update( { x: 0, y: 0, z: 0 } );
		await settle( landed );

		// The room view and the light slots run on separate timers, so a room
		// can be shown before it is lit; it must never be shown with no material.
		expect( landed.rooms ).toHaveLength( 1 );
		expect( landed.rooms[ 0 ].meshes.every( ( { mesh } ) => mesh.material?.name === 'cyberpunk/carpet/mid' ) ).toBe( true );

	} );

	it( 'puts the floor the player stands on in the scene and in the physics world', async () => {

		const landed = stream( async () => posted() );
		const solid = new Map();
		landed.onColliderBand = ( id, geometry ) => solid.set( id, geometry );

		landed.update( { x: 0, y: 0, z: 0 } );
		await settle( landed );
		landed.update( { x: 0, y: 0, z: 0 } );

		expect( landed.rooms[ 0 ].group.parent.visible ).toBe( true );
		expect( solid.get( 'p0:0' ).getAttribute( 'position' ).count ).toBe( 3 );

	} );

	it( 'lets a load go when the stream is disposed before it lands', async () => {

		let land = null;
		const dropped = stream( () => new Promise( ( resolve ) => { land = resolve; } ) );

		dropped.update( { x: 0, y: 0, z: 0 } );
		dropped.dispose();
		land( posted() );
		await settle( dropped );

		expect( dropped.rooms ).toHaveLength( 0 );
		expect( dropped.liveInteriors ).toBe( 0 );
		expect( dropped.workerDisposed ).toBe( true );

	} );

} );
