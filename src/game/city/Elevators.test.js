import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Elevators } from './Elevators.js';

/** Two floors of one shaft, as the interior box publishes them. */
const floors = [
	{ floor: 0, elevation: 0, height: 4, core: { elevators: [ LIFT() ] } },
	{ floor: 1, elevation: 4, height: 3.4, core: { elevators: [ LIFT() ] } }
];

function LIFT() {

	return { id: 'elev-0', rect: { x: 10, z: 20, w: 2.5, d: 2.5 }, doorEdge: 0 };

}

/** A pair of door leaves standing on the +x face of that shaft, at one floor. */
function doorGeometry( elevation ) {

	const quad = ( x0, x1 ) => [
		[ 11.25, elevation, 20 + x0 ], [ 11.25, elevation, 20 + x1 ], [ 11.25, elevation + 2.1, 20 + x1 ],
		[ 11.25, elevation, 20 + x0 ], [ 11.25, elevation + 2.1, 20 + x1 ], [ 11.25, elevation + 2.1, 20 + x0 ]
	];
	const points = [ ...quad( - 1, 0 ), ...quad( 0, 1 ) ];
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( points.flat(), 3 ) );

	return geometry;

}

const factory = {
	build: () => new THREE.MeshBasicMaterial(),
	variant: () => new THREE.MeshBasicMaterial()
};

function shafts() {

	const elevators = new Elevators( factory );
	const group = new THREE.Group();

	elevators.add( 'p1', floors, group );

	return { elevators, group };

}

/**
 * A lift is only rideable if three things hold: its doors come out of the
 * published geometry rather than being invented, pressing E moves the cab to a
 * floor the shaft really serves, and the cab carries whoever is standing in it,
 * because a character controller is not pushed by a moving collider.
 */
describe( 'Elevators', () => {

	it( 'takes the published door leaves out of the floor band they arrived in', () => {

		const { elevators, group } = shafts();
		const band = new THREE.Group();
		const left = elevators.claim( 'p1', 0, doorGeometry( 0 ), new THREE.MeshBasicMaterial(), band );

		// Both leaves went to the shaft, and nothing was left behind as a
		// second static door standing in front of the sliding one.
		expect( band.children ).toHaveLength( 2 );
		expect( left ).toBe( null );
		expect( group.children ).toHaveLength( 1 );

	} );

	it( 'leaves geometry that belongs to no shaft alone', () => {

		const { elevators } = shafts();
		const far = doorGeometry( 0 );
		far.translate( 40, 0, 0 );

		const left = elevators.claim( 'p1', 0, far, new THREE.MeshBasicMaterial(), new THREE.Group() );

		expect( left.getAttribute( 'position' ).count ).toBe( 12 );

	} );

	it( 'calls the cab to a floor the shaft serves and carries the rider there', () => {

		const { elevators } = shafts();
		const [ shaft ] = elevators.shafts;
		const body = playerAt( 10, 0.05, 20 );

		// Standing in the cab on the ground floor, pressing for the next floor.
		const inside = elevators.panels( body.feet, 3.2 ).find( ( p ) => p.inside );

		expect( inside ).toBeTruthy();

		shaft.press( inside );

		expect( shaft.target ).toBe( 4 );

		for ( let i = 0; i < 300 && shaft.moving; i ++ ) elevators.update( 1 / 60, body );

		expect( shaft.at ).toBeCloseTo( 4, 3 );
		expect( body.feet.y ).toBeCloseTo( 4.05, 2 );

	} );

	it( 'never sends the cab to a floor the shaft does not serve', () => {

		const { elevators } = shafts();
		const [ shaft ] = elevators.shafts;

		for ( let i = 0; i < 5; i ++ ) {

			shaft.press( { inside: true } );

			for ( let f = 0; f < 300 && shaft.moving; f ++ ) elevators.update( 1 / 60, playerAt( 0, 0, 0 ) );

			expect( [ 0, 4 ] ).toContain( Math.round( shaft.at ) );

		}

	} );

	it( 'holds its doors shut while it is moving', () => {

		const { elevators } = shafts();
		const [ shaft ] = elevators.shafts;
		const body = playerAt( 0, 0, 0 );

		elevators.update( 1 / 60, body );

		expect( shaft.stops[ 0 ].wanted ).toBe( 1 );

		shaft.press( { inside: false, stop: shaft.stops[ 1 ] } );
		elevators.update( 1 / 60, body );

		expect( shaft.stops.every( ( stop ) => stop.wanted === 0 ) ).toBe( true );

	} );

} );

/** The smallest thing that behaves like the player's physical body. */
function playerAt( x, y, z ) {

	const feet = new THREE.Vector3( x, y, z );

	return { feet, teleport: ( point ) => feet.copy( point ) };

}
