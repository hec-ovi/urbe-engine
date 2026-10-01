import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { vertexNormals } from './Normals.js';
import { whole } from './Steps.js';

/** Three's own normals of these positions and triangles. */
function threes( position, index ) {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.BufferAttribute( position.slice(), 3 ) );
	if ( index ) geometry.setIndex( new THREE.BufferAttribute( index, 1 ) );
	geometry.computeVertexNormals();
	return geometry.getAttribute( 'normal' ).array;

}

describe( 'stepped vertex normals', () => {

	it( 'gives three\'s normals to the bit, indexed or not, a degenerate corner and an unused vertex included', () => {

		const sphere = new THREE.SphereGeometry( 1.3, 96, 64 );
		const position = sphere.getAttribute( 'position' ).array;
		// A lumpy surface, so no two face normals agree by symmetry alone.
		for ( let i = 0; i < position.length; i ++ ) position[ i ] += Math.sin( i * 12.9898 ) * 0.01;
		const index = new Uint32Array( [ ...sphere.index.array, 0, 0, 5 ] );
		const unused = new Float32Array( [ ...position, 4, 5, 6 ] );
		expect( whole( vertexNormals( unused, index ) ) ).toEqual( threes( unused, index ) );

		const soup = sphere.toNonIndexed().getAttribute( 'position' ).array;
		expect( whole( vertexNormals( soup ) ) ).toEqual( threes( soup, null ) );

	} );

	it( 'hands the thread back every few thousand triangles', () => {

		const sphere = new THREE.SphereGeometry( 1, 128, 128 );
		const steps = vertexNormals( sphere.getAttribute( 'position' ).array, sphere.index.array );
		let yields = 0;
		while ( ! steps.next().done ) yields ++;
		expect( yields ).toBeGreaterThan( sphere.index.count / 3 / 4096 );

	} );

} );
