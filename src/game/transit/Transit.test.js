import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { transitVehiclesAt } from '../../../../connections/src/index.ts';
import { Transit } from './Transit.js';

/**
 * The transit contract makes four promises a player or a frame budget would
 * catch breaking: buses stand where the timetable says and nowhere else when
 * nothing is in service, a city with no bus stops pays nothing for them, a
 * city with many pays one draw per material, and every entrance publishes the
 * light its sign really emits.
 */
describe( 'Transit', () => {

	const small = city();

	it( 'puts a bus where the transit library says it is', () => {

		const route = busRoute();
		const transit = new Transit( {
			atlas: small, networks: { transit: { routes: [ route ] } }, factory: stubFactory()
		} );

		const t = route.service[ 0 ].start + 60;
		const player = new THREE.Vector3( 0, 0, 50 );

		transit.update( player, t );

		const [ vehicle ] = transitVehiclesAt( [ route ], t );
		const body = transit.group.getObjectByName( 'bus:body' );
		const placed = new THREE.Vector3().setFromMatrixPosition( readInstance( body, 0 ) );

		expect( transit.count ).toBe( 1 );
		expect( placed.toArray() ).toEqual( vehicle.position );
		// The shape is the +z axis, so being on it is the whole route check.
		expect( placed.x ).toBeCloseTo( 0, 6 );
		expect( placed.z ).toBeGreaterThan( 0 );
		expect( placed.z ).toBeLessThan( route.stops[ 1 ].shapeDist );

	} );

	it( 'runs no bus outside every service period', () => {

		const route = busRoute();
		const transit = new Transit( {
			atlas: small, networks: { transit: { routes: [ route ] } }, factory: stubFactory()
		} );

		transit.update( new THREE.Vector3(), route.service[ 0 ].end + 600 );

		const body = transit.group.getObjectByName( 'bus:body' );

		expect( transitVehiclesAt( [ route ], route.service[ 0 ].end + 600 ) ).toEqual( [] );
		expect( transit.count ).toBe( 0 );
		expect( body.count ).toBe( 0 );
		expect( body.visible ).toBe( false );

	} );

	it( 'builds nothing for a city with no bus stops', () => {

		const bare = city( { busStops: [] } );
		const transit = new Transit( { atlas: bare, networks: null, factory: stubFactory() } );

		expect( bare.transit.busStops ).toEqual( [] );
		expect( transit.group.getObjectByName( 'bus-shelters' ).children ).toEqual( [] );
		expect( transit.group.getObjectByName( 'buses' ).children ).toEqual( [] );
		expect( transit.colliders.get( 'transit:shelters' ) ).toBe( null );

	} );

	it( 'draws a whole city of bus stops as one instance set per material', () => {

		const many = city( { busStops: busStops( 24 ) } );
		const transit = new Transit( { atlas: many, networks: null, factory: stubFactory() } );
		const meshes = transit.group.getObjectByName( 'bus-shelters' ).children;
		const stops = many.transit.busStops.length;

		expect( stops ).toBe( 24 );
		expect( meshes.length ).toBe( 3 );

		for ( const mesh of meshes ) {

			expect( mesh.isInstancedMesh ).toBe( true );
			expect( mesh.count ).toBe( stops );

		}

		// One fixture per stop, each on its own shelter rather than stacked.
		expect( transit.glows.filter( ( glow ) => glow.range < 10 ).length ).toBe( stops );

	} );

	it( 'merges every station entrance and lights each one', () => {

		const transit = new Transit( { atlas: small, networks: null, factory: stubFactory() } );
		const meshes = transit.group.getObjectByName( 'station-entrances' ).children;
		const entrances = [ ...small.transit.trainStations, ...small.transit.subwayStations ]
			.reduce( ( total, station ) => total + station.entrances.length, 0 );

		expect( entrances ).toBeGreaterThan( 0 );
		// One band per mode plus the concrete of every entrance in the city.
		expect( meshes.length ).toBe( 3 );
		expect( meshes.every( ( mesh ) => mesh.isInstancedMesh !== true ) ).toBe( true );
		expect( transit.glows.filter( ( glow ) => glow.range > 10 ).length ).toBe( entrances );
		expect( transit.colliders.get( 'transit:entrances' ).getAttribute( 'position' ).count )
			.toBeGreaterThan( 0 );

	} );

} );

/**
 * A blueprint in the shape atlas publishes, holding only what transit reads:
 * one street to hang stops on, and whatever transit data the case is about.
 * Built here rather than read from a sample so a regenerated sibling city
 * cannot decide what this box's contract test proves.
 */
function city( transit = {} ) {

	return {
		streets: { edges: [ { id: 'e0', path: [ [ 0, 0 ], [ 200, 0 ] ] } ] },
		transit: {
			busStops: [],
			trainStations: [ station( 'ts0', 40 ) ],
			subwayStations: [ station( 'ss0', 120 ) ],
			...transit
		}
	};

}

function station( id, x ) {

	return {
		id, position: [ x, 60 ], districtId: 'd0', level: 0, shafts: [],
		platform: [ [ x - 20, 50 ], [ x + 20, 50 ], [ x + 20, 70 ], [ x - 20, 70 ] ],
		entrances: [ [ x - 4, 58 ], [ x + 4, 62 ] ]
	};

}

/** `count` stops spread along the one street, each far enough off it to face the kerb. */
function busStops( count ) {

	return Array.from( { length: count }, ( _, i ) => ( {
		id: `bs${i}`, edgeId: 'e0', districtId: 'd0',
		position: [ 4 + i * 8, 3 ]
	} ) );

}

/**
 * A bus route in the shape connections publishes: a straight 100 m shape, two
 * stops, a trip template over it and one morning service period.
 */
function busRoute() {

	return {
		id: 'Rb0', kind: 'bus', lineId: 'b0',
		stops: [
			{ stopId: 'bs0', x: 0, y: 0, z: 0, shapeDist: 0 },
			{ stopId: 'bs1', x: 0, y: 0, z: 100, shapeDist: 100 }
		],
		shape: [ [ 0, 0, 0 ], [ 0, 0, 100 ] ],
		template: [ { arrive: 0, depart: 10 }, { arrive: 110, depart: 110 } ],
		service: [ { start: 30000, end: 36000, headway: 1200, phase: 0 } ]
	};

}

function readInstance( mesh, index ) {

	const matrix = new THREE.Matrix4();
	mesh.getMatrixAt( index, matrix );

	return matrix;

}

/** The materials database is a browser fetch away; the geometry is the promise. */
function stubFactory() {

	const material = new THREE.MeshStandardMaterial();

	return { build: () => material, variant: () => material };

}
