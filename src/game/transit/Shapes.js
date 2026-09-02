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

/**
 * A vertical surface standing on a ring, from `top` down to `bottom`, broken
 * wherever `open( x, z )` says the wall is a way through. Each edge is walked in
 * short steps and the closed steps are joined back into runs, so a 140 m
 * platform wall with one doorway in it is two quads rather than five hundred.
 *
 * One surface, no thickness: the material is drawn from both sides, because a
 * station wall is seen from the room on one side and from the shaft on the
 * other. UVs are world metres, like everything else in this box.
 */
export function wall( ring, top, bottom, open = () => false, step = 0.4 ) {

	const positions = [];
	const uvs = [];
	const normals = [];
	let run = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const a = ring[ i ];
		const b = ring[ ( i + 1 ) % ring.length ];
		const dx = b[ 0 ] - a[ 0 ];
		const dz = b[ 1 ] - a[ 1 ];
		const length = Math.hypot( dx, dz );

		if ( length < 1e-6 ) continue;

		const ux = dx / length;
		const uz = dz / length;
		const nx = uz;
		const nz = - ux;
		const steps = Math.max( 1, Math.round( length / step ) );
		let from = null;

		for ( let k = 0; k <= steps; k ++ ) {

			const at = ( k / steps ) * length;
			const mid = ( ( k + 0.5 ) / steps ) * length;
			const closed = k < steps && ! open( a[ 0 ] + ux * mid, a[ 1 ] + uz * mid );

			if ( closed && from === null ) from = at;

			if ( ! closed && from !== null ) {

				quad( positions, uvs, normals, a, [ ux, uz ], [ nx, nz ], from, at, top, bottom, run );
				run += at - from;
				from = null;

			}

		}

	}

	if ( ! positions.length ) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

	return geometry;

}

function quad( positions, uvs, normals, a, [ ux, uz ], [ nx, nz ], from, to, top, bottom, run ) {

	const p = [ a[ 0 ] + ux * from, a[ 1 ] + uz * from ];
	const q = [ a[ 0 ] + ux * to, a[ 1 ] + uz * to ];
	const corners = [
		[ p, top, run ], [ q, top, run + to - from ], [ p, bottom, run ],
		[ p, bottom, run ], [ q, top, run + to - from ], [ q, bottom, run + to - from ]
	];

	for ( const [ point, y, u ] of corners ) {

		positions.push( point[ 0 ], y, point[ 1 ] );
		uvs.push( u, y );
		normals.push( nx, 0, nz );

	}

}

/**
 * Merges, or returns null for nothing, which is what an empty city yields.
 * Indexing is normalised first: a station mixes swept walls with triangulated
 * slabs, and merging only accepts one layout.
 */
export function merge( geometries ) {

	if ( ! geometries.length ) return null;

	const flat = geometries.map( ( geometry ) => ( geometry.index ? geometry.toNonIndexed() : geometry ) );

	return BufferGeometryUtils.mergeGeometries( flat, false );

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
