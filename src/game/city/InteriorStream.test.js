import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { floorAt, InteriorStream } from './InteriorStream.js';
import { Elevators } from './Elevators.js';
import { outlinesOf, partition } from './InteriorRooms.js';

/**
 * Six floors of one building: a basement, a tall lobby, four storeys. Each
 * carries one published room and the landing of one lift shaft.
 */
const LEVELS = [ [ - 1, - 3.2, 3.2 ], [ 0, 0, 4 ], [ 1, 4, 3.4 ], [ 2, 7.4, 3.4 ], [ 3, 10.8, 3.4 ], [ 4, 14.2, 3.4 ] ];
const floors = LEVELS.map( ( [ floor, elevation, height ] ) => ( {
	floor, elevation, height,
	glbUrl: `/out/p0/interior/floors/${floor}.glb`,
	rooms: [ { id: `r${floor}`, kind: 'living', polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 4 ], [ 0, 4 ] ] } ],
	core: { elevators: [ { id: 'elev-0', rect: { x: 10, z: 20, w: 2.5, d: 2.5 } } ] },
	lights: []
} ) );
const urlOf = ( floor ) => floors.find( ( level ) => level.floor === floor ).glbUrl;
const feetOn = ( floor ) => ( { x: 2, y: floors.find( ( level ) => level.floor === floor ).elevation + 0.1, z: 2 } );

/** One source mesh of one key, given as triangles of three world-space corners each. */
function surface( key, triangles ) {

	return {
		key,
		position: new Float32Array( triangles.flat( 2 ) ),
		normal: new Float32Array( triangles.length * 9 ),
		uv: new Float32Array( triangles.length * 6 )
	};

}

/** What one floor's own GLB holds: a patch of carpet in its room and the lift's door leaves on the +x face of the shaft. */
function surfacesOf( { elevation } ) {

	const y = elevation + 0.1;
	const quad = ( z0, z1 ) => [
		[ [ 11.25, y, 20 + z0 ], [ 11.25, y, 20 + z1 ], [ 11.25, y + 2.1, 20 + z1 ] ],
		[ [ 11.25, y, 20 + z0 ], [ 11.25, y + 2.1, 20 + z1 ], [ 11.25, y + 2.1, 20 + z0 ] ]
	];

	return [
		surface( 'cyberpunk/carpet/mid', [ [ [ 1, y, 1 ], [ 3, y, 1 ], [ 1, y, 3 ] ] ] ),
		surface( 'cyberpunk/elevator_door/mid', [ ...quad( - 1, 0 ), ...quad( 0, 1 ) ] )
	];

}

/** The worker, run in-process: cuts the floor a URL names against the building's outlines. */
function workerFor( fetched ) {

	return async ( url, outlines ) => {

		fetched.push( url );

		const floor = floors.find( ( level ) => level.glbUrl === url );

		return { cut: partition( surfacesOf( floor ), outlines ), bytes: 0, cost: {} };

	};

}

const factory = {
	tint: async () => null,
	build: () => new THREE.MeshBasicMaterial(),
	variant: () => new THREE.MeshBasicMaterial()
};

/** A stream with the building registered 3 m away and the worker stubbed. */
function stream( { cut, elevators = null, warmup = null } ) {

	const roomLights = {
		dim: { room: null },
		materialFor: ( binding, key ) => new THREE.MeshBasicMaterial( { name: key } )
	};
	const stream = new InteriorStream( { factory, roomLights, haze: null, elevators, warmup } );
	stream.worker = { cut, dispose: () => { stream.workerDisposed = true; } };
	stream.solid = new Map();
	stream.dropped = [];
	stream.onColliderBand = ( id, geometry ) => stream.solid.set( id, geometry );
	stream.onDropBand = ( id ) => { stream.solid.delete( id ); stream.dropped.push( id ); };
	stream.register( new Map( [ [ 'p0', { floors } ] ] ), new Map( [ [ 'p0', { x: 2, z: 2 } ] ] ) );

	return stream;

}

const tick = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

/** Frames until the stream asks for nothing more at these feet. */
async function settle( stream, feet ) {

	for ( ;; ) {

		stream.update( feet );

		if ( ! stream.loading ) return;

		while ( stream.loading ) await tick();

	}

}

const roomIds = ( stream ) => stream.rooms.map( ( room ) => room.id ).sort();
const bandGroup = ( stream, floor ) => stream.group.getObjectByName( `interior:p0:${floor}` );

/**
 * Streaming a tower a floor at a time only works if the floor the player is on
 * is picked right: pick the wrong one and they fall through the slab they are
 * standing on, or the room they walked into is not in the scene.
 */
describe( 'floorAt', () => {

	it( 'is the floor whose slab-to-slab band holds the feet', () => {

		expect( floorAt( floors, 0.05 ) ).toBe( 0 );
		expect( floorAt( floors, 3.9 ) ).toBe( 0 );
		expect( floorAt( floors, 4.1 ) ).toBe( 1 );
		expect( floorAt( floors, 8 ) ).toBe( 2 );
		expect( floorAt( floors, - 1 ) ).toBe( - 1 );

	} );

	it( 'is the nearest floor from outside the building, which is where the player usually is', () => {

		// On the pavement, a few centimetres above the lobby slab.
		expect( floorAt( floors, 0.12 ) ).toBe( 0 );
		// On a roof terrace over the top floor.
		expect( floorAt( floors, 40 ) ).toBe( 4 );

	} );

} );

describe( 'interior registration', () => {

	it( 'never opens a closed shell-only parcel', () => {

		const model = stream( { cut: workerFor( [] ) } );
		model.register(
			new Map( [ [ 'closed', { hasInterior: false, floors: [] } ] ] ),
			new Map( [ [ 'closed', { x: 2, z: 2 } ] ] )
		);
		model.update( { x: 2, y: 0, z: 2 } );

		expect( model.pending.has( 'closed' ) ).toBe( false );
		expect( model.live.has( 'closed' ) ).toBe( false );
		model.dispose();

	} );

} );

/**
 * A tower costs the floors around the player and nothing else: what is
 * fetched, what is solid and what stays in memory all follow the floor the
 * player stands on, and a floor that falls out of reach leaves nothing behind.
 */
describe( 'InteriorStream.update', () => {

	it( 'keeps ticking while a floor is still loading', () => {

		const feet = feetOn( 0 );
		const loading = stream( { cut: () => new Promise( () => {} ) } );

		loading.update( feet );

		expect( () => loading.update( feet ) ).not.toThrow();
		expect( loading.liveInteriors ).toBe( 1 );
		expect( loading.loading ).toBe( 1 );

	} );

	it( 'fetches only the floors within one of the player, that floor first, and makes them solid', async () => {

		const fetched = [];
		const landed = stream( { cut: workerFor( fetched ) } );

		await settle( landed, feetOn( 0 ) );

		expect( fetched[ 0 ] ).toBe( urlOf( 0 ) );
		expect( fetched.sort() ).toEqual( [ urlOf( - 1 ), urlOf( 0 ), urlOf( 1 ) ].sort() );
		expect( roomIds( landed ) ).toEqual( [ 'r-1', 'r0', 'r1' ] );
		expect( [ ...landed.solid.keys() ].sort() ).toEqual( [ 'p0:-1', 'p0:0', 'p0:1' ] );
		expect( landed.solid.get( 'p0:0' ).getAttribute( 'position' ).count ).toBe( 3 + 12 );
		expect( bandGroup( landed, 0 ).visible ).toBe( true );
		expect( bandGroup( landed, 3 ).children ).toHaveLength( 0 );

	} );

	it( 'warms a floor while it is still nowhere, before anything can draw it', async () => {

		const warmed = [];
		const warmup = { warm: async ( content ) => {

			warmed.push( { meshes: content.children.length, attached: content.parent !== null } );

			return 1;

		} };
		const landed = stream( { cut: workerFor( [] ), warmup } );

		await settle( landed, feetOn( 0 ) );

		// One per floor in the window, each still detached: a floor that reached
		// the scene before it was warmed would link its shaders in the frame it
		// first appears, which is the freeze this exists to stop.
		expect( warmed ).toHaveLength( 3 );
		expect( warmed.every( ( floor ) => floor.meshes > 0 ) ).toBe( true );
		expect( warmed.every( ( floor ) => floor.attached === false ) ).toBe( true );

	} );

	it( 'hands over every room already wearing a material', async () => {

		const landed = stream( { cut: workerFor( [] ) } );

		await settle( landed, feetOn( 0 ) );

		// The room view and the light slots run on separate timers, so a room
		// can be shown before it is lit; it must never be shown with no material.
		expect( landed.rooms.every( ( room ) => room.meshes.every( ( { mesh } ) => mesh.material?.name === 'cyberpunk/carpet/mid' ) ) ).toBe( true );

	} );

	it( 'moves the window with the player, keeping one floor of margin and dropping the rest', async () => {

		const fetched = [];
		const climbing = stream( { cut: workerFor( fetched ) } );

		await settle( climbing, feetOn( 0 ) );
		await settle( climbing, feetOn( 3 ) );

		expect( fetched.slice( 3 ).sort() ).toEqual( [ urlOf( 2 ), urlOf( 3 ), urlOf( 4 ) ].sort() );
		expect( [ ...climbing.solid.keys() ].sort() ).toEqual( [ 'p0:2', 'p0:3', 'p0:4' ] );
		// Floor 1 is two away: out of the scene, still in memory for the walk back down.
		expect( roomIds( climbing ) ).toEqual( [ 'r1', 'r2', 'r3', 'r4' ] );
		expect( bandGroup( climbing, 1 ).visible ).toBe( false );
		expect( bandGroup( climbing, 1 ).children ).toHaveLength( 1 );
		// Floors -1 and 0 are further: nothing of theirs is referenced any more.
		expect( bandGroup( climbing, 0 ).children ).toHaveLength( 0 );
		expect( bandGroup( climbing, - 1 ).children ).toHaveLength( 0 );

		await settle( climbing, feetOn( 1 ) );

		// Back down: floor 1 was kept and never refetched; floor 0 comes back.
		expect( fetched.filter( ( url ) => url === urlOf( 1 ) ) ).toHaveLength( 1 );
		expect( fetched.filter( ( url ) => url === urlOf( 0 ) ) ).toHaveLength( 2 );
		expect( roomIds( climbing ) ).toEqual( [ 'r0', 'r1', 'r2', 'r3' ] );

	} );

	it( 'gives the lift its landing doors as each floor lands and takes them back when it goes', async () => {

		const elevators = new Elevators( factory );
		const riding = stream( { cut: workerFor( [] ), elevators } );
		const atDoor = ( floor ) => new THREE.Vector3( 12, floors.find( ( level ) => level.floor === floor ).elevation + 1, 20 );

		await settle( riding, feetOn( 0 ) );

		// The shaft is registered from the floor documents before any floor is
		// loaded, so the cab exists and the landing at floor 0 has its panel.
		expect( elevators.shafts ).toHaveLength( 1 );
		expect( elevators.panels( atDoor( 0 ), 2 ) ).toHaveLength( 1 );
		expect( elevators.panels( atDoor( 4 ), 2 ) ).toHaveLength( 0 );

		await settle( riding, feetOn( 4 ) );

		expect( elevators.panels( atDoor( 4 ), 2 ) ).toHaveLength( 1 );
		expect( elevators.panels( atDoor( 0 ), 2 ) ).toHaveLength( 0 );
		expect( bandGroup( riding, 0 ).children ).toHaveLength( 0 );

	} );

	it( 'lets a load go when the stream is disposed before it lands', async () => {

		let land = null;
		const dropped = stream( { cut: () => new Promise( ( resolve ) => { land = resolve; } ) } );

		dropped.update( feetOn( 0 ) );
		dropped.dispose();
		land( { cut: partition( surfacesOf( floors[ 1 ] ), outlinesOf( floors ) ), bytes: 0, cost: {} } );
		while ( dropped.loading ) await tick();

		expect( dropped.rooms ).toHaveLength( 0 );
		expect( dropped.liveInteriors ).toBe( 0 );
		expect( dropped.workerDisposed ).toBe( true );

	} );

} );
