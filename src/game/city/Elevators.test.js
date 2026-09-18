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

/**
 * The published `lift-doors` module: two leaves meeting at its own zero, in the
 * module's frame, exactly as the module catalog hands it over.
 */
function doorModule() {

	const quad = ( x0, x1 ) => [
		[ x0, 0, 0 ], [ x1, 0, 0 ], [ x1, 2.2, 0 ],
		[ x0, 0, 0 ], [ x1, 2.2, 0 ], [ x0, 2.2, 0 ]
	];
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ ...quad( - 0.55, 0 ), ...quad( 0, 0.55 ) ].flat(), 3 ) );
	geometry.computeBoundingBox();

	return {
		boundsOf: () => ( { size: [ 1.1, 2.2, 0.06 ], origin: [ 0.55, 0, 0.03 ] } ),
		surfacesOf: () => [ { geometry, material: new THREE.MeshBasicMaterial() } ]
	};

}

/** Where a landing's leaves stand: on the +x face of that shaft, at one floor. */
function doorPlacement() {

	return { module: 'lift-doors', position: [ 11.25, 0, 21.25 ], rotationY: Math.PI / 2, scale: [ 1, 1, 1 ] };

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

	it( 'hangs the published landing module on sliders and gives it a call panel', () => {

		const { elevators, group } = shafts();
		const band = new THREE.Group();
		const taken = elevators.mount( 'p1', 0, doorPlacement(), doorModule(), band );

		expect( taken ).toBe( true );
		// One pivot in the band: two leaves and the call plate, and nothing left
		// behind as a second static door standing in front of the sliding one.
		expect( band.children ).toHaveLength( 1 );
		const [ stop ] = elevators.shafts[ 0 ].stops;
		expect( stop.leaves ).toHaveLength( 2 );
		expect( stop.leaves.map( ( leaf ) => Math.sign( leaf.userData.slide.x ) ).sort() ).toEqual( [ - 1, 1 ] );
		// The panel stands a pace out from the leaves, away from the shaft.
		expect( stop.panel.x ).toBeGreaterThan( 11.25 );
		expect( group.children ).toHaveLength( 1 );

	} );

	it( 'calls the cab to a floor the shaft serves and carries the rider there', () => {

		const { elevators } = shafts();
		const [ shaft ] = elevators.shafts;
		const body = playerAt( 11.25, 0.05, 21.25 );

		// Standing in the cab on the ground floor, pressing for the next floor.
		const inside = elevators.panels( body.feet, 3.2 ).find( ( p ) => p.inside );

		expect( inside ).toBeTruthy();

		shaft.press( inside );

		expect( shaft.target ).toBe( 4 );

		for ( let i = 0; i < 300 && shaft.moving; i ++ ) {

			elevators.update( 1 / 60, body );
			// While it travels, every landing on the shaft stays shut.
			if ( shaft.moving ) expect( shaft.stops.every( ( stop ) => stop.wanted === 0 ) ).toBe( true );

		}

		expect( shaft.at ).toBeCloseTo( 4, 3 );
		expect( body.feet.y ).toBeCloseTo( 4.05, 2 );

	} );

} );

/** The smallest thing that behaves like the player's physical body. */
function playerAt( x, y, z ) {

	const feet = new THREE.Vector3( x, y, z );

	return { feet, teleport: ( point ) => feet.copy( point ) };

}
