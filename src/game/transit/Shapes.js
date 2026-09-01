import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Primitives whose UVs are world metres, which is the convention every tiled
 * material entry is built for: the factory sets repeat = 1 / worldSize, so a
 * three.js primitive's 0..1 UVs would fit exactly one tile onto every face and
 * the same brick would span a 12 m bus flank and a 0.09 m post. Scaling each
 * face's UVs by its own size in metres is what makes one material read at one
 * scale everywhere in the box.
 */

/** Box centred on the origin. */
export function box( width, height, depth ) {

	const geometry = new THREE.BoxGeometry( width, height, depth );
	// BoxGeometry lays four vertices per face, in the order +x -x +y -y +z -z.
	const spans = [
		[ depth, height ], [ depth, height ],
		[ width, depth ], [ width, depth ],
		[ width, height ], [ width, height ]
	];

	scaleUvs( geometry, ( i ) => spans[ Math.floor( i / 4 ) ] );

	return strip( geometry );

}

/** Cylinder standing on Y, centred on the origin. */
export function tube( radius, height, segments = 10 ) {

	const geometry = new THREE.CylinderGeometry( radius, radius, height, segments, 1 );
	// The torso is written first, then the two caps: the torso wraps the
	// circumference and stands the height, a cap spans the diameter both ways.
	const torso = ( segments + 1 ) * 2;
	const side = [ 2 * Math.PI * radius, height ];
	const cap = [ radius * 2, radius * 2 ];

	scaleUvs( geometry, ( i ) => ( i < torso ? side : cap ) );

	return strip( geometry );

}

/** Merges, or returns null for nothing, which is what an empty city yields. */
export function merge( geometries ) {

	return geometries.length ? BufferGeometryUtils.mergeGeometries( geometries, false ) : null;

}

/**
 * The same geometries as one collider: positions and nothing else, in one
 * uniform layout, which is all a trimesh reads.
 */
export function solid( geometries ) {

	return merge( geometries.map( ( geometry ) => {

		const copy = new THREE.BufferGeometry();
		copy.setAttribute( 'position', geometry.getAttribute( 'position' ).clone() );

		return copy;

	} ) );

}

function scaleUvs( geometry, spanAt ) {

	const uv = geometry.getAttribute( 'uv' );

	for ( let i = 0; i < uv.count; i ++ ) {

		const [ u, v ] = spanAt( i );
		uv.setXY( i, uv.getX( i ) * u, uv.getY( i ) * v );

	}

}

/** Primitives carry a uv set nothing here uses, and merging wants one layout. */
function strip( geometry ) {

	geometry.deleteAttribute( 'uv1' );

	return geometry.index ? geometry.toNonIndexed() : geometry;

}
