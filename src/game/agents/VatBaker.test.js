import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { FRAMES, VatBaker } from './VatBaker.js';

describe( 'VAT surface normals', () => {

	it( 'skins the authored normals instead of deriving faceted triangle normals, one row per ask of the frame budget', async () => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			0, 0, 0, 1, 0, 0, 0, 1, 0
		], 3 ) );
		geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [
			1, 0, 0, 1, 0, 0, 1, 0, 0
		], 3 ) );
		geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
		], 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [
			1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0
		], 4 ) );

		const bone = new THREE.Bone();
		const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshBasicMaterial() );
		mesh.add( bone );
		mesh.bind( new THREE.Skeleton( [ bone ] ) );

		const root = new THREE.Group();
		root.add( mesh );
		let asked = 0;
		const slice = { step: async () => { asked ++; } };
		const [ baked ] = await VatBaker.bake( root, [ mesh ], [ new THREE.AnimationClip( 'idle', 1, [] ) ], slice );

		expect( asked ).toBe( FRAMES );

		for ( let row = 0; row < FRAMES; row ++ ) {

			for ( let vertex = 0; vertex < 3; vertex ++ ) {

				const offset = ( row * 3 + vertex ) * 4;
				expect( Array.from( baked.normal.slice( offset, offset + 3 ) ) ).toEqual( [ 1, 0, 0 ] );

			}

		}

	} );

} );
