import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Traffic } from './Traffic.js';

/**
 * The traffic contract: a car takes a turn connection at the end of its lane
 * and drives the curve through the intersection, it holds at a red, and two
 * cars never stand in the same place. Each of those is a thing a player sees
 * go wrong from the pavement.
 */
describe( 'Traffic', () => {

	it( 'drives the turn connection onto the next lane without jumping', () => {

		const traffic = new Traffic( {
			networks: corner( 20 ),
			models: stubModels(),
			signals: { green: () => true },
			capacity: 1,
			seed: 'corner'
		} );

		const player = new THREE.Vector3( 10, 0, 40 );

		traffic.update( 0.05, player, 0 );

		const car = traffic.cars[ 0 ];

		expect( car ).toBeTruthy();
		expect( car.lane.id ).toBe( 'A' );

		let previous = car.position.clone();
		let jump = 0;
		let arrived = false;

		for ( let step = 0; step < 400 && ! car.gone; step ++ ) {

			traffic.update( 0.05, player, 0 );
			jump = Math.max( jump, car.position.distanceTo( previous ) );
			previous.copy( car.position );

			if ( car.lane.id === 'B' && ! car.via ) arrived = true;

		}

		expect( arrived ).toBe( true );
		expect( jump ).toBeLessThan( 1 );

	} );

	it( 'holds at the stop line while the turn is red', () => {

		const traffic = new Traffic( {
			networks: corner( 20, { signalId: 's0', linkIndex: 0 } ),
			models: stubModels(),
			signals: { green: () => false },
			capacity: 1,
			seed: 'red'
		} );

		const player = new THREE.Vector3( 10, 0, 40 );

		traffic.update( 0.05, player, 0 );

		const car = traffic.cars[ 0 ];

		for ( let step = 0; step < 400; step ++ ) traffic.update( 0.05, player, 0 );

		expect( car.gone ).toBe( false );
		expect( car.via ).toBe( null );
		expect( car.lane.id ).toBe( 'A' );
		expect( car.distance ).toBeLessThanOrEqual( car.lane.length );

	} );

	it( 'holds short of a player standing in its lane and pushes them out of its body', () => {

		const traffic = new Traffic( {
			networks: corner( 20 ),
			models: stubModels(),
			signals: { green: () => true },
			capacity: 1,
			seed: 'corner'
		} );
		const far = new THREE.Vector3( 10, 0, 40 );

		traffic.update( 0.05, far, 0 );
		const car = traffic.cars[ 0 ];

		// somewhere with open road ahead on a straight lane
		for ( let step = 0; step < 400 && ( car.via || car.lane.length - car.distance < 8 ); step ++ ) traffic.update( 0.05, far, 0 );

		const forward = new THREE.Vector3( Math.sin( car.heading ), 0, Math.cos( car.heading ) );
		const player = car.position.clone().addScaledVector( forward, 4.6 / 2 + 9 );
		player.y = 0.12;
		let closest = Infinity;

		for ( let step = 0; step < 100; step ++ ) {

			traffic.update( 0.05, player, 0 );
			closest = Math.min( closest, player.clone().sub( car.position ).dot( forward ) - 4.6 / 2 );

		}

		expect( car.speed ).toBeLessThan( 0.05 );
		expect( closest ).toBeGreaterThan( 0.5 );

		expect( traffic.pushback( car.position.clone().addScaledVector( forward, 1 ).setY( 0.12 ), 0.32 ).length() ).toBeGreaterThan( 1 );
		expect( traffic.pushback( car.position.clone().addScaledVector( forward, 12 ).setY( 0.12 ), 0.32 ).length() ).toBe( 0 );

	} );

	it( 'never puts two cars in the same place', () => {

		const traffic = new Traffic( {
			networks: corner( 200 ),
			models: stubModels(),
			signals: { green: () => true },
			capacity: 6,
			seed: 'queue'
		} );

		const player = new THREE.Vector3( 100, 0, 40 );
		let closest = Infinity;

		for ( let step = 0; step < 400; step ++ ) {

			traffic.update( 0.05, player, 0 );

			for ( let i = 0; i < traffic.cars.length; i ++ ) {

				for ( let j = i + 1; j < traffic.cars.length; j ++ ) {

					closest = Math.min( closest, traffic.cars[ i ].position.distanceTo( traffic.cars[ j ].position ) );

				}

			}

		}

		expect( traffic.cars.length ).toBeGreaterThan( 1 );
		expect( closest ).toBeGreaterThan( 3 );

	} );

	it( 'follows lane and turn elevation without flattening either path', () => {

		const networks = corner( 20 );
		networks.road.lanes[ 0 ].path3 = [ [ 0, 0, 0 ], [ 20, 8, 0 ] ];
		networks.road.lanes[ 0 ].next[ 0 ].via3 = [
			[ 20, 8, 0 ], [ 23, 8, 0 ], [ 25, 8, 2 ], [ 25, 8, 5 ]
		];
		networks.road.lanes[ 1 ].path3 = [ [ 25, 8, 5 ], [ 25, 8, 60 ] ];
		const traffic = new Traffic( {
			networks,
			models: stubModels(),
			signals: { green: () => true },
			capacity: 1,
			seed: 'ramp'
		} );
		const player = new THREE.Vector3( 10, 0, 40 );

		traffic.update( 0.05, player, 0 );
		const car = traffic.cars[ 0 ];
		expect( car.position.y ).toBeGreaterThan( 0.02 );
		expect( car.pitch ).toBeCloseTo( Math.atan2( 8, 20 ) );

		for ( let step = 0; step < 400 && ! car.via; step ++ ) traffic.update( 0.05, player, 0 );

		expect( car.via ).toBeTruthy();
		expect( car.position.y ).toBeCloseTo( 8.02 );

	} );

	it( 'refuses a lane with no authoritative 3D path', () => {

		const networks = corner( 20 );
		delete networks.road.lanes[ 0 ].path3;

		expect( () => new Traffic( {
			networks,
			models: stubModels(),
			signals: { green: () => true },
			capacity: 1
		} ) ).toThrow( /E_MOVEMENT_PATH3: road lane A\.path3/ );

	} );

} );

/** Two lanes meeting at a corner, joined by one turn connection with a curve. */
function corner( length, signal ) {

	return {
		road: {
			lanes: [
				{
					id: 'A', edgeId: 'e0', index: 0, speed: 10, width: 3,
					path: [ [ 0, 0 ], [ length, 0 ] ],
					path3: [ [ 0, 0, 0 ], [ length, 0, 0 ] ],
					next: [ {
						laneId: 'B',
						turn: 'l',
						via: [ [ length, 0 ], [ length + 3, 0 ], [ length + 5, 2 ], [ length + 5, 5 ] ],
						via3: [ [ length, 0, 0 ], [ length + 3, 0, 0 ], [ length + 5, 0, 2 ], [ length + 5, 0, 5 ] ],
						...( signal ? { signal } : {} )
					} ]
				},
				{
					id: 'B', edgeId: 'e1', index: 0, speed: 10, width: 3,
					path: [ [ length + 5, 5 ], [ length + 5, 60 ] ],
					path3: [ [ length + 5, 0, 5 ], [ length + 5, 0, 60 ] ],
					next: []
				}
			]
		}
	};

}

function stubModels() {

	return { count: 1, setInstance: () => {}, commit: () => {} };

}
