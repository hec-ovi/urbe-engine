import * as THREE from 'three/webgpu';

const ATTRIBUTES = [ 'position', 'normal', 'uv' ];

/**
 * A new geometry holding just the listed triangles of `geometry`, given by the
 * index of each one's first vertex. Every pass that cuts merged city geometry
 * apart (a door leaf out of its shell, a room out of a tower, a floor band out
 * of an interior) is the same walk, so it is one function.
 *
 * The source is always non-indexed and always carries the three attributes the
 * city merges on, which is what lets this copy run flat.
 */
export function takeTriangles( geometry, starts ) {

	if ( ! starts.length ) return null;

	const out = new THREE.BufferGeometry();

	for ( const name of ATTRIBUTES ) {

		const source = geometry.getAttribute( name );

		if ( ! source ) continue;

		const size = source.itemSize;
		const data = new Float32Array( starts.length * 3 * size );
		let write = 0;

		for ( const start of starts ) {

			for ( let v = 0; v < 3; v ++ ) {

				for ( let k = 0; k < size; k ++ ) data[ write ++ ] = source.array[ ( start + v ) * size + k ];

			}

		}

		out.setAttribute( name, new THREE.BufferAttribute( data, size ) );

	}

	return out;

}

/** The centroid of the triangle starting at vertex `i`, into `target`. */
export function centroidAt( position, i, target, a, b, c ) {

	a.fromBufferAttribute( position, i );
	b.fromBufferAttribute( position, i + 1 );
	c.fromBufferAttribute( position, i + 2 );

	return target.copy( a ).add( b ).add( c ).multiplyScalar( 1 / 3 );

}
