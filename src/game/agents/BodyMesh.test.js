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
			expect( mesh.mesh.isInstancedMesh ).not.toBe( true );
			expect( mesh.mesh.geometry.isInstancedBufferGeometry ).toBe( true );

		}

	} );

} );
