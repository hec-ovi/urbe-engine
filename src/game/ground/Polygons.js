import * as THREE from 'three/webgpu';

/**
 * Atlas ground polygons ([x,z] rings, meters) turned into three.js geometry.
 * UVs are world meters on both surfaces and skirts, which is what the tiled
 * material entries expect (repeat = 1 / worldSize covers worldSize meters).
 */

/** Shoelace area of an [x,z] ring. Positive is counter-clockwise. */
export function signedArea( ring ) {

	let sum = 0;

	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		sum += ax * bz - bx * az;

	}

	return sum / 2;

}

/** True when [x, z] falls inside an [x,z] ring, by ray crossing. */
export function pointInRing( x, z, ring ) {

	let inside = false;

	for ( let i = 0, j = ring.length - 1; i < ring.length; j = i ++ ) {

		const [ ax, az ] = ring[ i ];
		const [ bx, bz ] = ring[ j ];

		if ( ( az > z ) !== ( bz > z ) && x < ( bx - ax ) * ( z - az ) / ( bz - az ) + ax ) inside = ! inside;

	}

	return inside;

}

/**
 * Horizontal surface at height y, facing +Y.
 * Shape space is (x, -z) so that the +Z face becomes the +Y face after the
 * rotation; earcut handles either input winding, so no ring is ever inverted.
 */
export function fill( ring, y ) {

	const shape = new THREE.Shape( ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
	const geometry = new THREE.ShapeGeometry( shape );
	geometry.rotateX( - Math.PI / 2 );
	geometry.translate( 0, y, 0 );

	return geometry;

}

/**
 * Vertical band around a ring, from `top` down to `bottom`, facing outward.
 * This is the curb: it seals the height step between two surfaces so no gap
 * can ever open at a sidewalk edge.
 */
export function skirt( ring, top, bottom ) {

	const ccw = signedArea( ring ) > 0;
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

		// Outward normal of a CCW ring edge is (dz, -dx); flip for CW input.
		const sign = ccw ? 1 : - 1;
		const nx = ( dz / length ) * sign;
		const nz = ( - dx / length ) * sign;

		const corners = ccw ? [ a, b ] : [ b, a ];
		const [ p, q ] = corners;
		const u0 = run;
		const u1 = run + length;

		// Two triangles, wound so the front face points along (nx, 0, nz).
		const pTop = [ p[ 0 ], top, p[ 1 ], u0, top ];
		const pBottom = [ p[ 0 ], bottom, p[ 1 ], u0, bottom ];
		const qTop = [ q[ 0 ], top, q[ 1 ], u1, top ];
		const qBottom = [ q[ 0 ], bottom, q[ 1 ], u1, bottom ];
		const quad = [ pTop, qTop, pBottom, pBottom, qTop, qBottom ];

		for ( const [ x, y, z, u, v ] of quad ) {

			positions.push( x, y, z );
			uvs.push( u, v );
			normals.push( nx, 0, nz );

		}

		run = u1;

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

	return geometry;

}

/** Axis-aligned bounds of a set of rings, as { min: [x,z], max: [x,z] }. */
export function ringBounds( rings ) {

	const min = [ Infinity, Infinity ];
	const max = [ - Infinity, - Infinity ];

	for ( const ring of rings ) {

		for ( const [ x, z ] of ring ) {

			min[ 0 ] = Math.min( min[ 0 ], x );
			min[ 1 ] = Math.min( min[ 1 ], z );
			max[ 0 ] = Math.max( max[ 0 ], x );
			max[ 1 ] = Math.max( max[ 1 ], z );

		}

	}

	return { min, max };

}
