import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { lights, objectGroup } from 'three/tsl';
import { Elevators } from './Elevators.js';
import { CAB, CAB_KELVIN } from './CabLight.js';
import { Warmup } from '../look/Warmup.js';
import { kelvinColor } from '../light/Color.js';
import { LIFT_CAR } from '../../../../interior/src/geometry/lift-spec.ts';

/** The room pool a module slot is lit by, as RoomLights hands every slot material one. */
const pool = [ new THREE.SpotLight(), new THREE.PointLight() ];
const slot = ( name ) => Object.assign( new THREE.MeshStandardNodeMaterial( { name } ), { lightsNode: lights( pool ) } );
const walls = slot( 'walls' );
const floor = slot( 'floor' );
const lens = new THREE.MeshBasicNodeMaterial( { name: 'lens' } );

function quads( ...spans ) {

	const quad = ( x0, x1 ) => [ [ x0, 0, 0 ], [ x1, 0, 0 ], [ x1, 2.2, 0 ], [ x0, 0, 0 ], [ x1, 2.2, 0 ], [ x0, 2.2, 0 ] ];
	const geometry = new THREE.BufferGeometry();
	const positions = spans.flatMap( ( [ x0, x1 ] ) => quad( x0, x1 ) ).flat();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( positions.map( ( _, i ) => ( i % 3 === 2 ? 1 : 0 ) ), 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Array( positions.length / 3 * 2 ).fill( 0 ), 2 ) );
	geometry.computeBoundingBox();

	return geometry;

}

const carGeometry = quads( [ - 0.8, 0.8 ] );
/** Two leaves meeting at the module's zero, as Interior publishes `lift-doors`. */
const leafGeometry = quads( [ - 0.55, 0 ], [ 0, 0.55 ] );

/** The module catalog as the city hands it over: the authored car and a landing's leaves. */
const catalog = {
	has: ( id ) => id === 'lift-car' || id === 'lift-doors',
	boundsOf: ( id ) => id === 'lift-car'
		? { size: [ LIFT_CAR.width, LIFT_CAR.floor + LIFT_CAR.ceiling + LIFT_CAR.roof, LIFT_CAR.depth ] }
		: { size: [ 1.1, 2.2, 0.06 ] },
	surfacesOf: ( id ) => id === 'lift-car'
		? [ walls, floor, lens ].map( ( material ) => ( { geometry: carGeometry, material } ) )
		: [ { geometry: leafGeometry, material: walls } ]
};

const button = new THREE.MeshStandardNodeMaterial( { name: 'button' } );
const factory = { build: () => button, variant: () => button };

/** One building's shaft at `x`: its floors, its car and a landing at each floor, the way the stream mounts them. */
function tower( elevators, parcelId, x ) {

	const lift = { id: 'elev-0', rect: { x, z: 20, w: 2.5, d: 2.5 }, doorEdge: 0 };
	const floors = [ 0, 1, 2 ].map( ( index ) => ( { floor: index, elevation: index * 4, height: 4, core: { elevators: [ lift ] } } ) );
	const [ shaft ] = elevators.add( parcelId, floors, new THREE.Group() );
	const landings = [];

	for ( const { floor: index } of floors ) {

		const band = new THREE.Group();
		elevators.mount( parcelId, index, { module: 'lift-car', position: [ x + 1.25, 0, 21.25 ], rotationY: 0, scale: [ 1, 1, 1 ] }, catalog, band );
		elevators.mount( parcelId, index, { module: 'lift-doors', position: [ x + 2.5, 0, 21.25 ], rotationY: Math.PI / 2, scale: [ 1, 1, 1 ] }, catalog, band );
		landings.push( band );

	}

	return { shaft, landings };

}

const meshes = ( ...objects ) => objects.flatMap( ( object ) => object.getObjectsByProperty( 'isMesh', true ) );

/**
 * A lift car lit by lights of its own builds a graph per surface no other car
 * can use, because three keys a graph by its lights' ids: seventy-two of them
 * in the one frame a tower of eight shafts comes into view. These hold the
 * cars and landings to one material per source for the run, lit per draw by
 * the lens of the shaft each surface stands in.
 */
describe( 'the lifts\' shared lighting', () => {

	it( 'dresses every car and landing in one material per source, whichever building they stand in', () => {

		const elevators = new Elevators( factory );
		const near = tower( elevators, 'p1', 10 );
		const far = tower( elevators, 'p2', 200 );
		const cars = meshes( near.shaft.car, far.shaft.car ).filter( ( mesh ) => mesh[ CAB ] );
		const leaves = meshes( ...near.landings, ...far.landings ).filter( ( mesh ) => mesh[ CAB ] );

		expect( cars ).toHaveLength( 6 );
		expect( new Set( cars.map( ( mesh ) => mesh.material ) ).size ).toBe( 3 );
		expect( cars.every( ( mesh ) => mesh[ CAB ] === ( mesh.parent === near.shaft.car ? near.shaft : far.shaft ) ) ).toBe( true );
		// The lit surfaces wear the car lights and nothing of the room pool; an unlit lens stays its own source.
		const lit = cars.filter( ( mesh ) => mesh.material !== lens );
		expect( lit.every( ( mesh ) => mesh.material.lightsNode === elevators.cabs.carLights ) ).toBe( true );
		expect( cars.filter( ( mesh ) => mesh.material === lens ) ).toHaveLength( 2 );

		// Two leaves at each of three landings of two shafts, all in the one landing material.
		expect( leaves ).toHaveLength( 12 );
		expect( new Set( leaves.map( ( mesh ) => mesh.material ) ).size ).toBe( 1 );
		const [ leaf ] = leaves;
		expect( leaf.material ).not.toBe( walls );
		expect( leaf.material.lightsNode.getLights() ).toEqual( expect.arrayContaining( [ ...pool, elevators.cabs.lens ] ) );

		// Every display draws the same two strokes in the same material.
		const display = meshes( near.shaft.screen, far.shaft.screen );
		expect( new Set( display.map( ( mesh ) => mesh.geometry ) ).size ).toBe( 2 );
		expect( new Set( display.map( ( mesh ) => mesh.material ) ).size ).toBe( 1 );

	} );

	it( 'lights each car by the lens of its own shaft, read per draw as three would read a rect light standing there', () => {

		const elevators = new Elevators( factory );
		const shafts = [ tower( elevators, 'p1', 10 ).shaft, tower( elevators, 'p2', 200 ).shaft ];
		const node = elevators.cabs.lens;
		const camera = new THREE.PerspectiveCamera();
		camera.position.set( 30, 6, - 12 );
		camera.lookAt( 100, 2, 20 );
		camera.updateMatrixWorld();
		const frame = new THREE.NodeFrame();
		frame.camera = camera;
		const uniforms = [ node.colorNode, node.viewPosition, node.halfWidth, node.halfHeight ];

		// Its values are the drawn object's own: the graph every car shares binds them per draw.
		expect( uniforms.every( ( uniform ) => uniform.groupNode === objectGroup ) ).toBe( true );
		const data = node.setupDirectRectArea( { isAvailable: () => true } );
		expect( data.lightPosition ).toBe( node.viewPosition );
		expect( data.halfWidth ).toBe( node.halfWidth );
		expect( data.halfHeight ).toBe( node.halfHeight );
		expect( data.lightColor ).toBe( node.colorNode );

		const draw = ( object ) => {

			frame.object = object;
			for ( const uniform of uniforms ) frame.updateNode( uniform );
			return uniforms.map( ( uniform ) => uniform.value.clone() );

		};

		for ( const shaft of shafts ) {

			// The light the car had of its own: a rect light at the lens, facing down, at the lens's lumens.
			const light = new THREE.RectAreaLight( kelvinColor( CAB_KELVIN ), 1, LIFT_CAR.lens.width * shaft.carScale.x, LIFT_CAR.lens.depth * shaft.carScale.z );
			light.power = LIFT_CAR.lens.lumens;
			light.position.copy( shaft.worldPoint( [ 0, LIFT_CAR.lens.center[ 1 ] - 0.015, 0 ] ) );
			light.quaternion.setFromAxisAngle( new THREE.Vector3( 0, 1, 0 ), shaft.yaw ).multiply( new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), - Math.PI / 2 ) );
			light.updateMatrixWorld( true );
			const reference = new THREE.RectAreaLightNode( light );
			reference.update( { camera } );

			const [ color, position, halfWidth, halfHeight ] = draw( shaft.car.children.find( ( mesh ) => mesh[ CAB ] ) );
			expect( color.r ).toBeCloseTo( reference.color.r, 6 );
			expect( color.g ).toBeCloseTo( reference.color.g, 6 );
			expect( color.b ).toBeCloseTo( reference.color.b, 6 );
			expect( position.distanceTo( light.position.clone().applyMatrix4( camera.matrixWorldInverse ) ) ).toBeLessThan( 1e-6 );
			expect( halfWidth.distanceTo( reference.halfWidth.value ) ).toBeLessThan( 1e-6 );
			expect( halfHeight.distanceTo( reference.halfHeight.value ) ).toBeLessThan( 1e-6 );

			// A landing is lit by the same lens, wherever its car is.
			const [ , atLanding ] = draw( shaft.stops[ 2 ].leaves[ 0 ].children[ 0 ] );
			expect( atLanding.distanceTo( position ) ).toBeLessThan( 1e-6 );

		}

		// The lens rides with its car.
		const [ first ] = shafts;
		const before = draw( first.car.children[ 0 ] )[ 1 ];
		first.press( { inside: false, stop: first.stopAt( 2 ) } );
		const rider = { feet: new THREE.Vector3( 0, 0, 0 ), teleport() {} };
		for ( let step = 0; step < 600 && ( first.moving || first.at === 0 ); step ++ ) elevators.update( 1 / 60, rider );
		expect( first.at ).toBeCloseTo( 8, 6 );
		const after = draw( first.car.children[ 0 ] )[ 1 ];
		expect( after.clone().sub( before ).length() ).toBeCloseTo( 8, 6 );

		// A surface that names no shaft is lit by no lens.
		expect( draw( new THREE.Mesh() )[ 0 ].getHex() ).toBe( 0 );

	} );

	it( 'leaves a warm-up nothing to build for any shaft once one of each is prepared', async () => {

		const elevators = new Elevators( factory );
		const specimen = elevators.specimen( catalog );
		const warmup = new Warmup( null, new THREE.Scene(), new THREE.PerspectiveCamera() );
		const wanted = warmup.programsOf( specimen );

		// The car's surfaces, a display stroke, a leaf, the call plate and its button.
		expect( wanted ).toHaveLength( 3 + 1 + 1 + 2 );
		for ( const [ , key ] of wanted ) warmup.warmed.add( key );

		const shafts = [ tower( elevators, 'p1', 10 ), tower( elevators, 'p2', 200 ), tower( elevators, 'p3', 400 ) ];
		for ( const { shaft, landings } of shafts ) {

			expect( warmup.programsOf( shaft.cab ) ).toEqual( [] );
			for ( const band of landings ) expect( warmup.programsOf( band ) ).toEqual( [] );

		}

		// What the specimen cut for itself goes; what every lift shares stays.
		const own = meshes( specimen ).filter( ( mesh ) => mesh.userData.specimen ).map( ( mesh ) => vi.spyOn( mesh.geometry, 'dispose' ) );
		const shared = meshes( specimen ).filter( ( mesh ) => ! mesh.userData.specimen ).map( ( mesh ) => vi.spyOn( mesh.geometry, 'dispose' ) );
		expect( own ).toHaveLength( 3 );
		elevators.discard( specimen );
		expect( own.every( ( spy ) => spy.mock.calls.length === 1 ) ).toBe( true );
		expect( shared.every( ( spy ) => spy.mock.calls.length === 0 ) ).toBe( true );

		// A catalog without a lift has nothing to prepare.
		expect( elevators.specimen( { has: () => false } ) ).toBeNull();

	} );

	it( 'keeps the shared set through a building let go and opened again, and draws its cars only while asked', () => {

		const elevators = new Elevators( factory );
		const first = tower( elevators, 'p1', 10 );
		const other = tower( elevators, 'p2', 200 );
		const worn = new Set( meshes( first.shaft.car, ...first.landings ).map( ( mesh ) => mesh.material ) );
		const disposed = [ ...worn, elevators.cabs.display.material ].map( ( material ) => vi.spyOn( material, 'dispose' ) );
		const strokes = [ elevators.cabs.display.across, elevators.cabs.display.upright ].map( ( geometry ) => vi.spyOn( geometry, 'dispose' ) );

		elevators.draw( 'p1', false );
		expect( first.shaft.cab.visible ).toBe( false );
		expect( other.shaft.cab.visible ).toBe( true );
		elevators.draw( 'p1', true );
		expect( first.shaft.cab.visible ).toBe( true );

		elevators.remove( 'p1' );
		expect( elevators.cars( 'p1' ) ).toEqual( [] );
		expect( disposed.every( ( spy ) => spy.mock.calls.length === 0 ) ).toBe( true );
		expect( strokes.every( ( spy ) => spy.mock.calls.length === 0 ) ).toBe( true );

		const again = tower( elevators, 'p1', 10 );
		expect( elevators.cars( 'p1' ) ).toEqual( [ again.shaft.car ] );
		expect( new Set( meshes( again.shaft.car, ...again.landings ).map( ( mesh ) => mesh.material ) ) ).toEqual( worn );
		expect( elevators.cabs.cars.size ).toBe( 2 );
		expect( elevators.cabs.landings.size ).toBe( 1 );

	} );

} );
