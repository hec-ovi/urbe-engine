import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { BodyMesh } from './BodyMesh.js';
import { HairMesh } from './HairMesh.js';

/** A WebGPU pipeline binds at most this many vertex buffers by default. */
const VERTEX_BUFFERS = 8;

/** A three-vertex body, baked for one clip, as CharacterAssets hands it over. */
function baked( vertexCount = 3, rows = 32 ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( new Float32Array( vertexCount * 3 ), 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( new Float32Array( vertexCount * 3 ), 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( vertexCount * 2 ), 2 ) );

	return {
		mesh: new THREE.Mesh( geometry ),
		vertexCount,
		rows,
		position: new Float32Array( vertexCount * rows * 4 ),
		normal: new Float32Array( vertexCount * rows * 4 )
	};
}

/**
 * The whole crowd is a handful of instanced draws, and each one only exists
 * if its pipeline is valid: three binds one vertex buffer per attribute, so
 * the geometry's own attributes plus the per-instance ones have to fit the
 * budget or the body is silently never drawn.
 */
describe( 'crowd meshes', () => {

	it( 'keep every mesh inside the vertex buffer budget', () => {

		const cloth = new THREE.BufferAttribute( new Float32Array( 3 * 4 ), 4 );
		const body = new BodyMesh( baked(), 4, false, { map: new THREE.Texture(), cloth } );
		const hair = new HairMesh( baked(), 4, false, { map: new THREE.Texture() } );

		for ( const mesh of [ body, hair ] ) {

			const bound = Object.keys( mesh.mesh.geometry.attributes ).length + mesh.attributes.length;

			expect( bound ).toBeLessThanOrEqual( VERTEX_BUFFERS );

		}

	} );

	it( 'writes a person into the packed attributes', () => {

		const cloth = new THREE.BufferAttribute( new Float32Array( 3 * 4 ), 4 );
		const body = new BodyMesh( baked(), 4, false, { map: new THREE.Texture(), cloth } );
		const look = { skin: { r: 0.5, g: 0.4, b: 0.3 }, shirt: { r: 0.1, g: 0.2, b: 0.9 }, trousers: { r: 0, g: 0, b: 0 }, sleeve: 0.7, hem: 0.2 };

		body.setInstance( 2, new THREE.Vector3( 1, 2, 3 ), 0.5, 7, 1, look );

		expect( body.motion.getW( 2 ) ).toBe( 0.5 );
		expect( body.motion.getZ( 2 ) ).toBe( 3 );
		expect( body.pose.getX( 2 ) ).toBe( 7 );
		expect( body.pose.getY( 2 ) ).toBe( 1 );
		expect( body.skins.getW( 2 ) ).toBeCloseTo( 0.7 );
		expect( body.shirts.getW( 2 ) ).toBeCloseTo( 0.2 );

	} );

} );
