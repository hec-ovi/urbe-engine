import { expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { Physics } from '../physics/Physics.js';
import { PlayerBody } from '../physics/PlayerBody.js';
import { SafetyGround } from './SafetyGround.js';

it( 'catches the real capsule far outside the city with a matching world-tiled surface', async () => {

	const { floor, physics, camera, material } = await fixture();
	expect( floor.elevation ).toBe( - 2 );
	for ( const [ x, z ] of [ [ 100000, - 100000 ], [ - 80000, 90000 ] ] ) {

		const body = new PlayerBody( physics, new THREE.Vector3( x, floor.elevation + 4, z ) );
		for ( let i = 0; i < 180; i ++ ) {

			physics.step( 1 / 60 );
			body.move( new THREE.Vector3(), 1 / 60 );

		}
		expect( body.feet.y ).toBeCloseTo( floor.elevation, 1 );
		expect( body.grounded ).toBe( true );
		camera.position.copy( body.eye );
		camera.far = 1500;
		camera.aspect = 2.3;
		camera.zoom = 0.7;
		camera.rotation.set( - 0.4, 0.7, 0 );
		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );
		floor.update( camera );
		floor.mesh.updateMatrixWorld( true );
		const bounds = new THREE.Box3().setFromObject( floor.mesh );
		expect( bounds.min.x ).toBeLessThan( x - camera.far );
		expect( bounds.max.z ).toBeGreaterThan( z + camera.far );
		expect( bounds.min.y ).toBeCloseTo( floor.elevation );
		for ( const x of [ - 1, 1 ] ) for ( const y of [ - 1, 1 ] ) {

			const corner = new THREE.Vector3( x, y, 1 ).unproject( camera );
			expect( corner.x ).toBeGreaterThan( bounds.min.x );
			expect( corner.x ).toBeLessThan( bounds.max.x );
			expect( corner.z ).toBeGreaterThan( bounds.min.z );
			expect( corner.z ).toBeLessThan( bounds.max.z );

		}
		const position = floor.mesh.geometry.getAttribute( 'position' );
		const uv = floor.mesh.geometry.getAttribute( 'uv' );
		for ( let i = 0; i < position.count; i ++ ) {

			const world = new THREE.Vector3().fromBufferAttribute( position, i ).applyMatrix4( floor.mesh.matrixWorld );
			expect( uv.getX( i ) ).toBeCloseTo( world.x, 1 );
			expect( uv.getY( i ) ).toBeCloseTo( world.z, 1 );

		}

	}
	const geometryDispose = vi.spyOn( floor.mesh.geometry, 'dispose' );
	const materialDispose = vi.spyOn( material, 'dispose' );
	const handle = floor.handle.collider.handle;
	floor.dispose();
	expect( physics.world.getCollider( handle ) ).toBeNull();
	expect( geometryDispose ).toHaveBeenCalledOnce();
	expect( materialDispose ).not.toHaveBeenCalled();
	physics.world.free();

} );

it( 'keeps the half-space below basements, tunnel geometry, station shafts and water bottoms', async () => {

	for ( const source of [ 'floor', 'geometry', 'station', 'water' ] ) {

		const group = new THREE.Group();
		if ( source === 'geometry' ) group.add( new THREE.Mesh( new THREE.BoxGeometry( 8, 4, 8 ).translate( 0, - 18, 0 ) ) );
		const atlas = source === 'station' ? { transit: { subwayStations: [ { box: { bottom: - 18 }, shafts: [ { bottom: - 20 } ] } ] } }
			: source === 'water' ? { hydrology: { bodies: [ { elevation: - 3, depth: 17 } ] } } : {};
		const buildings = new Map( [ [ 'building', { blueprint: { floors: [ { elevation: source === 'floor' ? - 20 : 0 } ] } } ] ] );
		const { floor, physics } = await fixture( { atlas, buildings, groups: [ group ] } );
		expect( floor.elevation ).toBe( - 22 );
		const ray = new physics.rapier.Ray( { x: 0, y: - 20, z: 0 }, { x: 0, y: - 1, z: 0 } );
		physics.step( 1 / 60 );
		expect( physics.world.castRay( ray, 1.9, true ) ).toBeNull();
		expect( physics.world.castRay( ray, 3, true ).timeOfImpact ).toBeCloseTo( 2 );
		floor.dispose();
		group.traverse( ( item ) => item.geometry?.dispose() );
		physics.world.free();

	}

} );

it( 'rejects a non-finite collision elevation', async () => {

	const physics = await Physics.create();
	expect( () => physics.addHalfSpace( NaN ) ).toThrow( 'E_PHYSICS_FLOOR' );
	physics.world.free();

} );

async function fixture( options = {} ) {

	const physics = await Physics.create();
	const camera = new THREE.PerspectiveCamera( 60, 1, 0.1, 1000 );
	const material = new THREE.MeshStandardMaterial();
	const floor = new SafetyGround( {
		atlas: {}, buildings: new Map(), groups: [], ...options,
		physics, camera, factory: { build: () => material }
	} );
	return { floor, physics, camera, material };

}
