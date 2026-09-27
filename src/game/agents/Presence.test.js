import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vehiclePresence, stepPresence, coveredMaterial } from './Presence.js';

it( 'shares opaque dither coverage across vehicle body and lamps', () => {

	const meshes = [ new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial() ].map( material =>
		new THREE.InstancedMesh( new THREE.BoxGeometry(), material, 2 ) );
	const coverage = vehiclePresence( meshes, 2 );
	coverage.setX( 0, 0.25 );
	for ( const mesh of meshes ) {

		expect( mesh.material.isNodeMaterial ).toBe( true );
		expect( mesh.material.maskShadowNode ).toBe( mesh.material.maskNode );
		expect( mesh.material.transparent ).toBe( false );
		expect( mesh.material.maskNode ).toBeTruthy();

	}
	expect( stepPresence( 0, false, 0.4 ) ).toBe( 0.5 );
	expect( stepPresence( 1, true, 0.3 ) ).toBe( 0.5 );
	expect( stepPresence( 0.1, true, 1 ) ).toBe( 0 );

} );

it.each( [ false, true ] )( 'packs crowd coverage into the pose buffer with storage=%s', async storage => {
	const { BodyMesh } = await import( './BodyMesh.js' );
	const { FRAMES } = await import( './VatBaker.js' );
	const geometry = new THREE.PlaneGeometry();
	const count = geometry.getAttribute( 'position' ).count;
	const baked = { mesh: new THREE.Mesh( geometry ), vertexCount: count, rows: FRAMES,
		position: new Float32Array( count * FRAMES * 4 ), normal: new Float32Array( count * FRAMES * 4 ) };
	const body = new BodyMesh( baked, 2, storage, { map: new THREE.Texture(), cloth: new THREE.Float32BufferAttribute( new Float32Array( count * 4 ), 4 ) } );
	const tint = new THREE.Color( 0.5, 0.5, 0.5 );
	body.setInstance( 0, new THREE.Vector3( 1, 2, 3 ), 0, 5, 0,
		{ skin: tint, shirt: tint, trousers: tint, sleeve: 0.8, hem: 0.8 }, 0.25 );
	body.commit( 1 );
	expect( body.pose.itemSize ).toBe( 3 );
	expect( body.pose.getZ( 0 ) ).toBe( 0.25 );
	expect( body.attributes.length + Object.keys( body.mesh.geometry.attributes ).length ).toBeLessThanOrEqual( 8 );
	expect( body.mesh.castShadow ).toBe( true );
	expect( body.mesh.material.maskShadowNode ).toBe( body.mesh.material.maskNode );
	expect( body.mesh.material.normalNode ).toBeTruthy();
	expect( body.mesh.material.roughnessNode ).toBeTruthy();
} );

it( 'retains transmissive vehicle glazing when installing coverage', async () => {
	const { uniform } = await import( 'three/tsl' );
	const material = coveredMaterial( new THREE.MeshPhysicalMaterial( { transmission: 0.7, thickness: 0.15, roughness: 0.2 } ), uniform( 0.5 ) );
	expect( material ).toBeInstanceOf( THREE.MeshPhysicalNodeMaterial );
	expect( material ).toMatchObject( { transmission: 0.7, thickness: 0.15, roughness: 0.2 } );
	expect( material.maskShadowNode ).toBe( material.maskNode );
} );
