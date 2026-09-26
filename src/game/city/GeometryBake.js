import { Float32BufferAttribute } from 'three';

/**
 * World-space, always with normals. Merging needs one layout, so it is
 * non-indexed unless the caller keeps the producer's index (`indexed`), which
 * a published normal allows: a copy drawn many times shades each shared vertex
 * once, and a simplifier needs the triangles' shared corners.
 */
export function bake( mesh, { indexed = false } = {} ) {

	const keep = indexed && mesh.geometry.index && mesh.geometry.getAttribute( 'normal' );
	const geometry = ( mesh.geometry.index && ! keep ? mesh.geometry.toNonIndexed() : mesh.geometry.clone() );

	// A producer may publish positions quantized into a normalized integer, with
	// the scale back to metres in the node transform. Applying that transform
	// writes metres, which do not fit the normalized range, so the attribute
	// becomes plain floats first.
	plain( geometry, 'position' );
	geometry.applyMatrix4( mesh.matrixWorld );

	if ( ! geometry.getAttribute( 'normal' ) ) geometry.computeVertexNormals();
	if ( ! geometry.getAttribute( 'uv' ) ) {

		const count = geometry.getAttribute( 'position' ).count;
		geometry.setAttribute( 'uv', new Float32BufferAttribute( new Float32Array( count * 2 ), 2 ) );

	}

	geometry.deleteAttribute( 'tangent' );
	geometry.deleteAttribute( 'uv1' );
	geometry.deleteAttribute( 'color' );

	return geometry;

}

/** One attribute as plain 32-bit floats, in the units it reads as. */
export function plain( geometry, name ) {

	const attribute = geometry.getAttribute( name );
	if ( ! attribute || ( attribute.array instanceof Float32Array && ! attribute.normalized ) ) return attribute;

	const { count, itemSize } = attribute;
	const values = new Float32Array( count * itemSize );

	for ( let i = 0; i < count; i ++ ) {

		for ( let c = 0; c < itemSize; c ++ ) values[ i * itemSize + c ] = attribute.getComponent( i, c );

	}
	geometry.setAttribute( name, new Float32BufferAttribute( values, itemSize ) );

	return geometry.getAttribute( name );

}
