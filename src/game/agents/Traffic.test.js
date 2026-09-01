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

} );

/** Two lanes meeting at a corner, joined by one turn connection with a curve. */
function corner( length, signal ) {

	return {
		road: {
			lanes: [
				{
					id: 'A', edgeId: 'e0', index: 0, speed: 10, width: 3,
					path: [ [ 0, 0 ], [ length, 0 ] ],
					next: [ {
						laneId: 'B',
						turn: 'l',
						via: [ [ length, 0 ], [ length + 3, 0 ], [ length + 5, 2 ], [ length + 5, 5 ] ],
						...( signal ? { signal } : {} )
					} ]
				},
				{
					id: 'B', edgeId: 'e1', index: 0, speed: 10, width: 3,
					path: [ [ length + 5, 5 ], [ length + 5, 60 ] ],
					next: []
				}
			]
		}
	};

}

function stubModels() {

	return { count: 1, setInstance: () => {}, commit: () => {} };

}
