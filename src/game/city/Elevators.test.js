import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from '../physics/Physics.js';
import { PlayerBody } from '../physics/PlayerBody.js';
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

it( 'selects any served floor without wrapping, waits for closed doors and a loaded landing', () => {
	let ready = false;
	const stream = { requestFloor: () => true, releaseFloor() {}, floorShown: () => ready };
	const elevators = new Elevators( factory );
	elevators.stream = stream;
	const tower = Array.from( { length: 24 }, ( _, floor ) => ( { floor, elevation: floor * 4.5, height: 4.5, core: { elevators: [ LIFT() ] } } ) );
	const [ shaft ] = elevators.add( 'p1', tower, new THREE.Group() );
	shaft.select( 100 );
	expect( shaft.selected ).toBe( 23 );
	shaft.select( 1 );
	expect( shaft.selected ).toBe( 23 );
	shaft.press( { inside: true } );
	const body = playerAt( 11.25, 0.05, 21.25 );
	for ( let i = 0; i < 240; i ++ ) elevators.update( 0.1, body );
	expect( shaft.at ).toBeCloseTo( 103.5, 6 );
	expect( body.feet.y ).toBeCloseTo( 103.55 );
	expect( shaft.stops[ 23 ].wanted ).toBe( 0 );
	ready = true;
	elevators.update( 0.2, body );
	expect( shaft.stops[ 23 ].wanted ).toBe( 1 );
	shaft.select( - 1 );
	shaft.press( { inside: true } );
	const at = shaft.at;
	elevators.update( 0.05, body );
	expect( shaft.at ).toBe( at );
	expect( shaft.floorAt ).toBe( at );
	for ( let i = 0; i < 40; i ++ ) elevators.update( 0.1, body );
	expect( shaft.at ).toBe( 99 );
} );

it( 'carries a real physics capsule up a tower without accumulating gravity, then restores landing collision', async () => {
	const physics = await Physics.create();
	const solids = new Map();
	const colliders = {
		solid: ( id, boxes ) => { solids.set( id, physics.addBoxes( boxes ) ); },
		drop: id => { const solid = solids.get( id ); if ( solid ) physics.world.removeRigidBody( solid.body ); solids.delete( id ); }
	};
	const elevators = new Elevators( factory, colliders );
	const tower = Array.from( { length: 24 }, ( _, floor ) => ( { floor, elevation: floor * 4.5, height: 4.5, core: { elevators: [ LIFT() ] } } ) );
	const [ shaft ] = elevators.add( 'p1', tower, new THREE.Group() );
	const body = new PlayerBody( physics, new THREE.Vector3( 11.25, 0.05, 21.25 ) );
	shaft.select( 100 ); shaft.press( { inside: true } );
	let offset;
	for ( let frame = 0; frame < 650; frame ++ ) {
		physics.step( 1 / 30 );
		body.move( new THREE.Vector3(), 1 / 30 );
		elevators.update( 1 / 30, body );
		if ( shaft.moving ) {
			offset ??= body.feet.y - shaft.at;
			expect( body.carried ).toBe( true );
			expect( body.feet.y - shaft.at ).toBeCloseTo( offset, 5 );
		}
	}
	expect( shaft.at ).toBeCloseTo( 103.5, 6 );
	expect( body.feet.y ).toBeGreaterThan( 103.4 );
	expect( body.carried ).toBe( false );
	expect( body.collider.isEnabled() ).toBe( true );
	physics.world.free();
} );

/** A landing module of two solid leaves, `seam` apart at its zero, as boxes of twelve triangles each. */
function boxLeaves( seam ) {

	const geometry = new THREE.BufferGeometry();
	const parts = [ - 1, 1 ].map( ( side ) => {

		const box = new THREE.BoxGeometry( 0.55 - seam / 2, 2.2, 0.06 ).toNonIndexed();
		box.translate( side * ( 0.55 + seam / 2 ) / 2, 1.1, 0 );
		return box.getAttribute( 'position' ).array;

	} );
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ ...parts[ 0 ], ...parts[ 1 ] ], 3 ) );
	geometry.computeBoundingBox();
	return { surfacesOf: () => [ { geometry, material: new THREE.MeshBasicMaterial() } ] };

}

it( 'shuts a landing whose leaves were published with a seam between them, and keeps the faces where a pair meets', () => {

	for ( const seam of [ 0.01, 0 ] ) {

		const { elevators } = shafts();
		elevators.mount( 'p1', 0, doorPlacement(), boxLeaves( seam ), new THREE.Group() );
		const [ stop ] = elevators.shafts[ 0 ].stops;
		const [ left, right ] = stop.leaves;

		// Every face of both boxes, the two where the leaves meet included.
		for ( const leaf of stop.leaves ) expect( leaf.children[ 0 ].geometry.getAttribute( 'position' ).count ).toBe( 36 );
		// Shut, each leaf stands its seam's half in, so the pair meets at the zero.
		expect( left.position.x ).toBeCloseTo( seam / 2, 6 );
		expect( right.position.x ).toBeCloseTo( - seam / 2, 6 );

		// Open, each runs half the pair's width out, eased in and out.
		stop.setOpen( true, 0.35 );
		const quarter = right.position.x;
		expect( quarter ).toBeGreaterThan( - seam / 2 );
		expect( quarter ).toBeLessThan( - seam / 2 + ( 0.55 + seam / 2 ) / 4 );
		stop.setOpen( true, 2 );
		expect( right.position.x ).toBeCloseTo( 0.55, 6 );
		expect( left.position.x ).toBeCloseTo( - 0.55, 6 );

	}

} );

describe( 'a floor that never stands', () => {

	function ride( failed ) {

		const shown = new Set( [ 0 ] );
		const stream = {
			requestFloor: () => true, releaseFloor() {},
			floorShown: ( parcel, floor ) => shown.has( floor ),
			floorFailed: ( parcel, floor ) => failed && floor === 1
		};
		const elevators = new Elevators( factory );
		elevators.stream = stream;
		const [ shaft ] = elevators.add( 'p1', floors, new THREE.Group() );
		const body = { feet: new THREE.Vector3( 11.25, 0.05, 21.25 ), carried: false,
			beginCarry() { this.carried = true; }, carryTo( point ) { this.feet.copy( point ); }, endCarry( point ) { this.feet.copy( point ); this.carried = false; } };
		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		shaft.press( elevators.panels( body.feet, 3.2 ).find( ( p ) => p.inside ) );
		return { shaft, elevators, body, warn };

	}

	it.each( [ [ 'failed to build', true, 10 ], [ 'did not stand', false, 60 ] ] )( 'takes the rider back to the floor they left when the one they chose %s', ( said, failed, seconds ) => {

		const { shaft, elevators, body, warn } = ride( failed );

		try {

			let arrived = false;
			for ( let t = 0; t < seconds; t += 0.05 ) {

				elevators.update( 0.05, body );
				arrived ||= shaft.at === 4;
				// Shut in the shaft, the rider is carried and no landing opens.
				if ( ! arrived || shaft.moving ) expect( shaft.stops.every( ( stop ) => stop.wanted === 0 ) ).toBe( true );

			}
			expect( arrived ).toBe( true );
			expect( shaft.at ).toBe( 0 );
			expect( shaft.stops[ 0 ].wanted ).toBe( 1 );
			expect( body.carried ).toBe( false );
			expect( body.feet.y ).toBeCloseTo( 0.05, 6 );
			expect( shaft.stops[ shaft.selected ].floor ).toBe( 0 );
			expect( warn.mock.calls.flat().join( ' ' ) ).toContain( `floor 1 ${said}, back to floor 0` );

		} finally {

			warn.mockRestore();

		}

	} );

	it( 'waits at a floor that is still coming, and a slow one is not given up on early', () => {

		const { shaft, elevators, body, warn } = ride( false );

		try {

			for ( let t = 0; t < 30; t += 0.05 ) elevators.update( 0.05, body );
			expect( shaft.at ).toBe( 4 );
			expect( body.carried ).toBe( true );

		} finally {

			warn.mockRestore();

		}

	} );

} );
