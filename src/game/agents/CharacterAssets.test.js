import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { characterParts, crowdCloth, mergeBaked } from './CharacterAssets.js';

describe( 'crowd character composition', () => {

	it( 'requires and keeps the body, eyes and eyebrows surfaces', () => {

		const root = new THREE.Group();
		const body = part( 'RegularMale', 6 );
		const eyes = part( 'Eyes', 3 );
		const eyebrows = part( 'Eyebrows', 3 );
		root.add( eyes, body, eyebrows );

		expect( characterParts( root ) ).toEqual( { body, eyes, eyebrows } );
		root.remove( eyes );
		expect( () => characterParts( root ) ).toThrow( /body, eyes and eyebrows/ );

	} );

	it( 'merges each animated row in the same order as its geometry', () => {

		const body = baked( 'body', 2, 2, 10 );
		const eyes = baked( 'eyes', 1, 2, 90 );
		const joined = mergeBaked( [ body, eyes ] );

		expect( joined.vertexCount ).toBe( 3 );
		expect( joined.rows ).toBe( 2 );
		expect( joined.mesh.geometry.getAttribute( 'position' ).count ).toBe( 3 );
		expect( Array.from( joined.position ) ).toEqual( [
			10, 11, 12, 13, 14, 15, 16, 17, 90, 91, 92, 93,
			18, 19, 20, 21, 22, 23, 24, 25, 94, 95, 96, 97
		] );

	} );

	it( 'marks merged eye vertices without changing the body garment map', () => {

		const body = new THREE.Float32BufferAttribute( [ 0.5, 2, 2, 0, 0.75, 0.25, 2, 0 ], 4 );
		const cloth = crowdCloth( body, 2 );

		expect( Array.from( cloth.array ) ).toEqual( [
			0.5, 2, 2, 0, 0.75, 0.25, 2, 0,
			- 1, 2, 2, 0, - 1, 2, 2, 0
		] );

	} );

} );

function part( name, vertices ) {

	const geometry = geometryOf( vertices );
	const mesh = new THREE.SkinnedMesh( geometry );
	mesh.name = name;
	return mesh;

}

function baked( name, vertexCount, rows, start ) {

	const values = Float32Array.from( { length: vertexCount * rows * 4 }, ( _, i ) => start + i );

	return {
		mesh: new THREE.Mesh( geometryOf( vertexCount ) ),
		vertexCount,
		rows,
		position: values,
		normal: values.slice()
	};

}

function geometryOf( vertices ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( new Float32Array( vertices * 3 ), 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( new Float32Array( vertices * 3 ), 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( vertices * 2 ), 2 ) );
	return geometry;

}
