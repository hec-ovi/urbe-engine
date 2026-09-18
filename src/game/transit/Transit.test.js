import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { transitVehiclesAt } from '../../../../connections/src/index.ts';
import { Transit } from './Transit.js';

describe( 'Transit', () => {

	const small = city();

	it( 'places every mode exactly where the transit library says, bounded, and nothing outside service', () => {

		const routes = [
			busRoute(),
			railRoute( 'train', 'Rt0', 't0', 40, 0 ),
			railRoute( 'subway', 'Rs0', 's0', 120, -12 )
		];
		const built = [];
		const transit = new Transit( {
			atlas: small, networks: { transit: { routes } }, factory: stubFactory( built ), capacity: 1
		} );
		const time = 30060;
		transit.update( new THREE.Vector3( 60, 0, 50 ), time );

		const expected = new Map( transitVehiclesAt( routes, time ).map( ( vehicle ) => [ vehicle.kind, vehicle ] ) );
		for ( const kind of [ 'bus', 'train', 'subway' ] ) {

			const group = transit.group.getObjectByName( kind === 'bus' ? 'buses' : `${kind}s` );
			const body = transit.group.getObjectByName( `${kind}:body` );
			const placed = new THREE.Vector3().setFromMatrixPosition( readInstance( body, 0 ) );

			expect( group.children ).toHaveLength( 3 );
			expect( group.children.every( ( mesh ) => mesh.isInstancedMesh && mesh.count === 1 ) ).toBe( true );
			expect( placed.toArray() ).toEqual( expected.get( kind ).position );

		}
		expect( transit.count ).toBe( 3 );
		expect( built.slice( -9 ) ).toEqual( [
			'cyberpunk/metal/mid', 'cyberpunk/glass/mid', 'cyberpunk/rubber/mid',
			'cyberpunk/metal/mid', 'cyberpunk/glass/mid', 'cyberpunk/rubber/mid',
			'cyberpunk/metal/mid', 'cyberpunk/glass/mid', 'cyberpunk/rubber/mid'
		] );

		const closed = routes[ 0 ].service[ 0 ].end + 600;
		transit.update( new THREE.Vector3(), closed );
		expect( transitVehiclesAt( routes, closed ) ).toEqual( [] );
		expect( transit.count ).toBe( 0 );
		expect( transit.group.getObjectByName( 'bus:body' ).count ).toBe( 0 );
		expect( transit.group.getObjectByName( 'bus:body' ).visible ).toBe( false );

	} );

	it( 'builds nothing for a city with no bus stops and one instance set per material for a full one', () => {

		const bare = new Transit( { atlas: city( { busStops: [] } ), networks: null, factory: stubFactory() } );
		expect( bare.group.getObjectByName( 'bus-shelters' ).children ).toEqual( [] );
		expect( bare.group.getObjectByName( 'buses' ).children ).toEqual( [] );
		expect( bare.colliders.get( 'transit:shelters' ) ).toBe( null );

		const many = city( { busStops: busStops( 24 ) } );
		const transit = new Transit( { atlas: many, networks: null, factory: stubFactory() } );
		const meshes = transit.group.getObjectByName( 'bus-shelters' ).children;
		const stops = many.transit.busStops.length;

		expect( meshes.length ).toBe( 3 );
		for ( const mesh of meshes ) {

			expect( mesh.isInstancedMesh ).toBe( true );
			expect( mesh.count ).toBe( stops );

		}
		// One fixture per stop, each on its own shelter rather than stacked.
		expect( transit.glows.filter( ( glow ) => glow.lumens === 180 ).length ).toBe( stops );

	} );

	it( 'merges every station entrance and lights each one', () => {

		const transit = new Transit( { atlas: small, networks: null, factory: stubFactory() } );
		const meshes = transit.group.getObjectByName( 'station-entrances' ).children;
		const entrances = [ ...small.transit.trainStations, ...small.transit.subwayStations ]
			.reduce( ( total, station ) => total + station.entrances.length, 0 );

		expect( entrances ).toBeGreaterThan( 0 );
		// Legacy entrances at grade still merge their machines by surface role.
		expect( meshes.map( mesh => mesh.name ).sort() ).toEqual( [
			'entrance:edge', 'entrance:metal', 'entrance:paint', 'entrance:rubber', 'entrance:screen', 'entrance:text'
		] );
		expect( meshes.every( ( mesh ) => mesh.isInstancedMesh !== true ) ).toBe( true );
		expect( transit.glows.filter( ( glow ) => glow.lumens === 700 ).length ).toBe( entrances );
		expect( transit.colliders.get( 'transit:entrances' ).getAttribute( 'position' ).count )
			.toBeGreaterThan( 0 );
		for ( const collider of transit.colliders.values() ) {

			if ( ! collider ) continue;
			expect( collider.index ).toBe( null );
			expect( collider.getAttribute( 'position' ).count % 3 ).toBe( 0 );

		}

	} );

} );

/** The atlas shape transit reads: one street to hang stops on, plus the transit data the case is about. */
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

/** `count` stops along the one street, each far enough off it to face the kerb. */
function busStops( count ) {

	return Array.from( { length: count }, ( _, i ) => ( {
		id: `bs${i}`, edgeId: 'e0', districtId: 'd0',
		position: [ 4 + i * 8, 3 ]
	} ) );

}

/** The connections route shape: a straight 100 m line, two stops, a trip template and one morning service period. */
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

function railRoute( kind, id, lineId, x, y ) {

	const stationId = kind === 'train' ? 'ts0' : 'ss0';
	return {
		id, kind, lineId,
		stops: [
			{ stopId: stationId, x, y, z: 0, shapeDist: 0 },
			{ stopId: `${stationId}-far`, x, y, z: 100, shapeDist: 100 }
		],
		shape: [ [ x, y, 0 ], [ x, y, 100 ] ],
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
function stubFactory( built = [] ) {

	const material = new THREE.MeshStandardMaterial();

	return {
		build: ( key ) => {

			built.push( key );
			return material;

		},
		variant: () => material
	};

}
