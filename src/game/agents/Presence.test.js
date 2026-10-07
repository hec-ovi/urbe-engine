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
	const { lookOf } = await import( './Appearance.js' );
	const { EASE_ROWS, packLook } = await import( './CrowdLook.js' );
	const { defaultRecipe } = await import( './avatar/Recipe.js' );
	const { FRAMES } = await import( './VatBaker.js' );
	const geometry = new THREE.PlaneGeometry();
	const count = geometry.getAttribute( 'position' ).count;
	const baked = { mesh: new THREE.Mesh( geometry ), vertexCount: count, rows: FRAMES,
		position: new Float32Array( count * FRAMES * 4 ), normal: new Float32Array( count * FRAMES * 4 ),
		builds: new Float32Array( count * 4 ), ease: new Float32Array( count * EASE_ROWS * 4 ) };
	const body = new BodyMesh( baked, 2, storage, { map: new THREE.Texture(), cloth: new THREE.Float32BufferAttribute( new Float32Array( count * 4 ), 4 ), height: 1.8, bottom: 0 } );
	const look = lookOf( defaultRecipe( 'regular-female' ) );
	body.setInstance( 0, new THREE.Vector3( 1, 2, 3 ), 0, 5, 0, look, 0.25 );
	body.commit( 1 );
	// Frame, clip and coverage, the garments worn above it, and the figure the look packs in the fourth lane.
	expect( body.pose.itemSize ).toBe( 4 );
	expect( body.pose.getZ( 0 ) % 2 ).toBe( 0.25 );
	expect( Math.floor( body.pose.getZ( 0 ) / 2 ) ).toBe( packLook( look ).garments );
	expect( packLook( look ).garments ).toBeGreaterThan( 0 );
	expect( body.pose.getW( 0 ) ).toBe( packLook( look ).figure );
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
