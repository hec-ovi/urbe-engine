import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { buildModules } from '../../../../interior/src/modules/index.ts';
import { apartmentEntrances, apartmentSlots } from '../../../../interior/src/styles/luxury/apartment-doors.ts';
import { generate as exterior } from '../../../../exterior/src/index.ts';
import { generate as interior } from '../../../../interior/src/index.ts';
import { InteriorStream } from './InteriorStream.js';
import { ApartmentDoors, buildApartmentDoors } from './ApartmentDoors.js';
import { buildingFloors } from './InteriorLayouts.js';
import { floorBoxes } from './InteriorBoxes.js';
import { bake } from './GeometryBake.js';
import { Interactor } from '../player/Interactor.js';
import { DoorColliders } from '../physics/DoorColliders.js';
import { Physics } from '../physics/Physics.js';
import { PlayerBody } from '../physics/PlayerBody.js';
import { cityGltfLoader } from '../data/CityGltfLoader.js';

const STEP = 1 / 60;
/** The door runs at the Interactor's speed: a full open or close takes 1 / 2.2 s. */
const FULL_RUN = 1 / 2.2;

/** A corridor and the living room of one home off it, its entry door in the wall between. */
const ROOMS = [
	{ id: 'corridor', kind: 'corridor', polygon: [ [ - 2, - 2 ], [ 4, - 2 ], [ 4, 0 ], [ - 2, 0 ] ], doors: [] },
	{
		id: 'living', kind: 'living', unit: 'f1-position-0', polygon: [ [ - 2, 0 ], [ 4, 0 ], [ 4, 5 ], [ - 2, 5 ] ],
		doors: [ { id: 'entry', to: 'corridor', width: 0.9, leaves: 1, position: [ 0.45, 0 ], angleDeg: 0 } ]
	}
];

describe( 'private apartment doors through streaming, interaction and physics', () => {

	it( 'opens, walks through, recloses and streams real apartment modules at any yaw, without making an exterior entrance', async () => {

		const modules = await apartmentModules();
		const [ source ] = apartmentEntrances( ROOMS, 1, apartmentSlots( [ ROOMS ] ) );

		for ( const [ degrees, floor, style ] of [ [ 0, 1, 'luxury' ], [ 37, 2, 'capsule' ], [ 180, 3, 'damaged' ] ] ) {

			const yaw = degrees * Math.PI / 180;
			const record = turned( source, yaw, floor, style );
			const physics = await Physics.create();

			try {

				physics.addTrimesh( new THREE.PlaneGeometry( 30, 30 ).rotateX( - Math.PI / 2 ).translate( 0, record.elevation, 0 ) );
				const registry = new ApartmentDoors( physics );
				const group = buildApartmentDoors( record, modules );
				group.updateMatrixWorld( true );
				registry.show( record.id, group.userData.apartmentDoors );

				const [ door ] = registry.doors;
				expect( door.name ).toBe( `apartment ${record.apartmentEntrances[ 0 ].number}` );
				expect( door.role ).toBe( 'apartment' );
				expect( door.outside ).toBeUndefined();

				const inward = new THREE.Vector3( 0, 0, 1 ).applyAxisAngle( UP, yaw );
				const start = door.center.clone().addScaledVector( inward, - 1.1 ).add( new THREE.Vector3( 0, 0.02, 0 ) );
				const body = new PlayerBody( physics, start );
				const interactor = controls( registry, new DoorColliders( physics, [] ), start, inward );
				const walk = () => walkThrough( physics, body, start, inward, door, 100 );

				expect( walk() ).toBeLessThan( - 0.2 );

				expect( interactor.update( 0, null ) ).toMatch( new RegExp( `open.*apartment ${door.number}` ) );
				interactor.activate( { timeMin: 0 } );
				const fixed = group.children.slice( 2 ).map( ( part ) => part.matrixWorld.elements.slice() );

				for ( const fraction of [ 0.5, 1 ] ) {

					interactor.update( FULL_RUN / 2, null );
					physics.step( STEP );
					expect( door.open ).toBeCloseTo( fraction, 6 );

					for ( const leaf of door.pivots ) {

						// The collider stands exactly where the drawn leaf does, and a
						// pocket leaf slides along its published travel without turning.
						const drawn = leaf.pivot.getWorldQuaternion( new THREE.Quaternion() );
						const rotation = leaf.collision.body.rotation();
						expect( Math.abs( drawn.dot( new THREE.Quaternion( rotation.x, rotation.y, rotation.z, rotation.w ) ) ) ).toBeCloseTo( 1, 6 );
						expect( leaf.pivot.quaternion.angleTo( leaf.closedRotation ) ).toBeLessThan( 1e-7 );

						const expected = leaf.closedPosition.clone().addScaledVector( leaf.translation, fraction );
						const solid = leaf.collision.body.translation();
						expect( leaf.pivot.position.distanceTo( expected ) ).toBeLessThan( 1e-7 );
						expect( expected.distanceTo( new THREE.Vector3( solid.x, solid.y, solid.z ) ) ).toBeLessThan( 1e-6 );

					}

				}

				expect( walk() ).toBeGreaterThan( 0.5 );
				// The track, its end stops and the numberplate never move.
				expect( group.children.slice( 2 ).map( ( part ) => part.matrixWorld.elements.slice() ) ).toEqual( fixed );

				expect( interactor.update( 0, null ) ).toMatch( /close/ );
				interactor.activate( { timeMin: 0 } );
				interactor.update( FULL_RUN, null );
				physics.step( STEP );
				expect( walk() ).toBeLessThan( - 0.2 );

				// Left open, a floor let go and built again stands its door open.
				door.wanted = 1;
				interactor.update( FULL_RUN, null );
				physics.step( STEP );
				registry.hide( record.id );
				expect( registry.doors ).toHaveLength( 0 );
				expect( door.pivots[ 0 ].collision ).toBeNull();

				const rebuilt = buildApartmentDoors( record, modules );
				rebuilt.updateMatrixWorld( true );
				registry.show( record.id, rebuilt.userData.apartmentDoors );
				expect( registry.doors ).toHaveLength( 1 );
				expect( registry.doors[ 0 ].open ).toBe( 1 );
				registry.hide( record.id );

			} finally {

				physics.world.free();

			}

		}

	}, 60_000 );

	it( 'admits a shown floor\'s doors, drops a hidden one\'s and forgets a building let go', async () => {

		const [ entrance ] = apartmentEntrances( ROOMS, 1, { 'bay:-2.000:0.000': 1 } );
		const physics = await Physics.create();
		const modules = {
			group: new THREE.Group(),
			boundsOf: () => ( { size: [ 1, 1, 1 ], origin: [ 0, 0, 0 ] } ),
			slotsOf: () => [],
			has: () => true,
			surfacesOf: () => [ { geometry: new THREE.BoxGeometry( 0.9, 2.5, 0.06 ).translate( 0.45, 1.25, 0 ), material: new THREE.MeshBasicMaterial() } ]
		};
		const stream = new InteriorStream( { modules, roomLights: { releaseRooms() {} }, haze: null } );
		stream.apartmentDoors = new ApartmentDoors( physics );
		stream.onColliderBand = () => true;
		stream.onDropBand = () => {};

		const floor = { height: 4.5, rooms: [ { ...ROOMS[ 1 ], doors: [] } ], core: { stairs: [], elevators: [], shafts: [] }, lights: [] };
		const building = {
			interior: {
				building: { layouts: { middle: 'middle.json' }, floors: [ { index: 1, elevation: 4.5, layout: 'middle', apartmentEntrances: [ entrance ] } ] },
				layouts: { middle: { floor, placements: [] } }
			},
			blueprint: { bounds: { footprint: [ [ - 2, - 2 ], [ 4, - 2 ], [ 4, 5 ], [ - 2, 5 ] ] } }
		};
		stream.register( new Map( [ [ 'p', building ] ] ), new Map( [ [ 'p', { x: 0, z: 0 } ] ] ) );

		try {

			await stream.prepare( new THREE.Vector3( 0, 4.51, - 1 ) );
			expect( stream.floorShown( 'p', 1 ) ).toBe( true );
			expect( stream.apartmentDoors.doors ).toHaveLength( 1 );
			// At floor level: the Interactor aims at handle height above it.
			expect( stream.apartmentDoors.doors[ 0 ].center.y ).toBe( 4.5 );

			stream.apartmentDoors.doors[ 0 ].open = 1;
			stream.update( new THREE.Vector3( 500, 4.51, 500 ) );
			expect( stream.apartmentDoors.doors ).toHaveLength( 0 );
			expect( stream.apartmentDoors.states.size ).toBe( 0 );

			await stream.prepare( new THREE.Vector3( 0, 4.51, - 1 ) );
			expect( stream.apartmentDoors.doors ).toHaveLength( 1 );
			expect( stream.apartmentDoors.doors[ 0 ].open ).toBe( 0 );

			stream.dispose();
			expect( stream.apartmentDoors.doors ).toHaveLength( 0 );

		} finally {

			physics.world.free();

		}

	} );

	it( 'refuses an entrance that is not a pair of pocket leaves', () => {

		const [ entrance ] = apartmentEntrances( ROOMS, 1, { 'bay:-2.000:0.000': 1 } );
		const modules = { surfacesOf: () => [ { geometry: new THREE.BoxGeometry( 0.9, 2.5, 0.06 ), material: new THREE.MeshBasicMaterial() } ] };
		const record = ( changed ) => ( { id: 'p:1', parcelId: 'p', floor: 1, elevation: 4.5, apartmentEntrances: [ { ...entrance, ...changed } ] } );

		expect( buildApartmentDoors( record( {} ), modules ).userData.apartmentDoors ).toHaveLength( 1 );
		expect( () => buildApartmentDoors( record( { motion: { kind: 'swing', maxTravel: 95, sign: - 1 } } ), modules ) ).toThrow( /E_APARTMENT_DOOR/ );
		expect( () => buildApartmentDoors( record( { leaves: entrance.leaves.slice( 0, 1 ) } ), modules ) ).toThrow( /E_APARTMENT_DOOR/ );
		expect( () => buildApartmentDoors( record( { width: 3 } ), modules ) ).toThrow( /E_APARTMENT_DOOR/ );
		expect( () => buildApartmentDoors( record( {} ), { surfacesOf: () => [] } ) ).toThrow( /E_APARTMENT_DOOR/ );

	} );

	it( 'leaves an entrance it cannot stand open, and builds the rest of the floor, when told who hears the refusal', () => {

		const [ entrance ] = apartmentEntrances( ROOMS, 1, { 'bay:-2.000:0.000': 1 } );
		const box = () => [ { geometry: new THREE.BoxGeometry( 0.9, 2.5, 0.06 ), material: new THREE.MeshBasicMaterial() } ];
		const modules = { surfacesOf: ( id ) => ( id === 'absent' ? [] : box() ) };
		const record = { id: 'p:1', parcelId: 'p', floor: 1, elevation: 4.5, apartmentEntrances: [
			{ ...entrance, id: 'broken', fixed: [ ...entrance.fixed, { ...entrance.fixed[ 0 ], module: 'absent' } ] },
			{ ...entrance, id: 'swing', motion: { kind: 'swing', maxTravel: 95, sign: - 1 } },
			{ ...entrance, id: 'whole' }
		] };
		const heard = [];

		const group = buildApartmentDoors( record, modules, { refused: ( one, error ) => heard.push( [ one.id, error.code ] ) } );

		expect( heard ).toEqual( [ [ 'broken', 'E_APARTMENT_DOOR' ], [ 'swing', 'E_APARTMENT_DOOR' ] ] );
		expect( group.userData.apartmentDoors.map( ( door ) => door.id ) ).toEqual( [ 'p:1:whole' ] );
		// Only the standing door's leaves and fixed parts join the floor.
		expect( group.children ).toHaveLength( 2 + entrance.fixed.length );
		expect( () => buildApartmentDoors( record, modules ) ).toThrow( /E_APARTMENT_DOOR/ );

	} );

	// Interior alone takes over a minute to furnish this building, so the test
	// has five minutes where a full suite runs it beside everything else.
	it( 'walks the numbered entrances on every residential floor of a six-storey balcony-grid building', async () => {

		const request = {
			seed: 'luxury-reference-review', buildingId: 'p0', theme: 'cyberpunk',
			parcel: {
				footprint: [ [ 81.5, 34 ], [ 121.5, 34 ], [ 121.5, 74 ], [ 81.5, 74 ] ], accessPoint: [ 101.5, 34 ], maxHeight: 31.5,
				buildingGrid: { origin: [ 81.5, 34 ], angle: 0, spacing: 0.5 },
				streetAccess: { edgeId: 'e0', path: [ [ 21.6, 21.6 ], [ 183.1, 21.6 ] ] }
			},
			building: { type: 'residential', tier: 'high_rich', floors: 6 },
			options: { architecture: 'balcony-grid', glb: 'merged' }
		};
		const { blueprint } = await exterior( request, { textures: { mode: 'keys' } } );
		const generated = await interior( {
			seed: request.seed, building: { id: 'p0', type: request.building.type, tier: request.building.tier },
			blueprint, materialTheme: 'cyberpunk'
		}, { models: new Set() } );
		const modules = await apartmentModules();
		const records = buildingFloors( 'p0', generated ).filter( ( record ) => record.apartmentEntrances.length );

		expect( records ).toHaveLength( 5 );

		for ( const record of records ) {

			const physics = await Physics.create();

			try {

				physics.addBoxes( floorBoxes( record.placements, record.elevation, modules.boundsOf ) );
				const registry = new ApartmentDoors( physics );
				const group = buildApartmentDoors( record, modules );
				group.updateMatrixWorld( true );
				registry.show( record.id, group.userData.apartmentDoors );
				const colliders = new DoorColliders( physics, [] );
				const body = new PlayerBody( physics, new THREE.Vector3( 0, record.elevation + 0.02, 0 ) );

				for ( const [ index, door ] of registry.doors.entries() ) {

					const published = record.apartmentEntrances[ index ];
					const inward = new THREE.Vector3( published.inward[ 0 ], 0, published.inward[ 1 ] );
					const start = door.center.clone().addScaledVector( inward, - 0.8 ).add( new THREE.Vector3( 0, 0.02, 0 ) );
					const interactor = controls( registry, colliders, start, inward );
					const walk = () => walkThrough( physics, body, start, inward, door, 70 );

					expect( walk(), `${door.number} shut` ).toBeLessThan( - 0.2 );

					expect( interactor.update( 0, null ) ).toMatch( new RegExp( `open.*apartment ${door.number}` ) );
					interactor.activate( { timeMin: 0 } );
					interactor.update( FULL_RUN, null );
					physics.step( STEP );
					expect( walk(), `${door.number} open` ).toBeGreaterThan( 0.45 );

					interactor.update( 0, null );
					interactor.activate( { timeMin: 0 } );
					interactor.update( FULL_RUN, null );
					physics.step( STEP );
					expect( walk(), `${door.number} shut again` ).toBeLessThan( - 0.2 );

				}

				registry.hide( record.id );
				expect( registry.doors ).toHaveLength( 0 );

			} finally {

				physics.world.free();

			}

		}

	}, 300_000 );

} );

const UP = new THREE.Vector3( 0, 1, 0 );

/** The apartment modules Interior builds, as the city catalog hands their surfaces and bounds over. */
async function apartmentModules() {

	const built = await buildModules( { theme: null } );
	const catalog = new Map( built.catalog.modules.map( ( entry ) => [ entry.id, entry ] ) );
	const surfaces = new Map();

	for ( const entry of built.catalog.modules.filter( ( one ) => one.id.startsWith( 'apartment-' ) ) ) {

		const loaded = await cityGltfLoader().parseAsync( new Uint8Array( built.files.get( entry.file ) ).buffer, '' );
		loaded.scene.updateMatrixWorld( true );
		const parts = [];
		loaded.scene.traverse( ( node ) => {

			if ( node.isMesh ) parts.push( { geometry: bake( node ), material: new THREE.MeshBasicMaterial() } );

		} );
		surfaces.set( entry.id, parts );

	}

	return { surfacesOf: ( id ) => surfaces.get( id ) ?? [], boundsOf: ( id ) => catalog.get( id ) };

}

/** One published entrance, turned about a point of its floor and worn in another style's modules. */
function turned( source, yaw, floor, style ) {

	const origin = new THREE.Vector3( 2, 0, 1 );
	const place = ( position ) => new THREE.Vector3( ...position ).applyAxisAngle( UP, yaw ).add( origin );
	const entrance = structuredClone( source );
	const centre = place( [ source.position[ 0 ], 0, source.position[ 1 ] ] );
	entrance.number = `${floor}01`;
	entrance.position = [ centre.x, centre.z ];

	for ( const part of [ ...entrance.leaves, ...entrance.fixed ] ) {

		part.position = place( part.position ).toArray();
		part.rotationY += yaw;
		part.module = part.module.replace( /-luxury$/, `-${style}` );

	}

	return { id: `review:${floor}`, parcelId: 'review', floor, elevation: floor * 4.5, apartmentEntrances: [ entrance ] };

}

/** An Interactor standing at `start`, looking along `inward`, with only the apartment doors to target. */
function controls( registry, doorColliders, start, inward ) {

	return new Interactor( {
		crowd: { within: () => [] }, doors: [], sim: {}, doorColliders,
		controller: { body: { feet: start }, eye: start.clone().add( new THREE.Vector3( 0, 1.08, 0 ) ), look: inward },
		interiors: { apartmentDoors: registry, pending: new Map(), requestFloor() {}, releaseFloor() {} }
	} );

}

/** Walks the player from `start` along `inward` at 1.4 m/s; returns how far past the doorway they got. */
function walkThrough( physics, body, start, inward, door, frames ) {

	body.teleport( start );
	const step = inward.clone().multiplyScalar( 1.4 * STEP );

	for ( let frame = 0; frame < frames; frame ++ ) {

		physics.step( STEP );
		body.move( step, STEP );

	}

	return body.feet.clone().sub( door.center ).dot( inward );

}
