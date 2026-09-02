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
export function skirt( ring, top, bottom, keep = () => true ) {

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

		if ( length < 1e-6 || ! keep( a, b ) ) continue;

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

/** A mitre offset longer than this many widths is a spike, not a kerb: cap it. */
const MITRE_LIMIT = 2.5;

/**
 * The kerb top: a flat band `width` wide just inside a ring, at height `y`,
 * facing up, its corners mitred so two edges meet in one stone. Together with
 * the skirt below it, this is what a sidewalk edge is made of.
 */
export function ledge( ring, y, width, keep = () => true ) {

	const ccw = signedArea( ring ) > 0;
	const points = ccw ? ring : [ ...ring ].reverse();
	const n = points.length;
	const inward = [];

	for ( let i = 0; i < n; i ++ ) {

		const p = points[ i ];
		const prev = points[ ( i + n - 1 ) % n ];
		const next = points[ ( i + 1 ) % n ];
		// Inward normals of the two edges meeting at p (a CCW ring's outward normal is (dz, -dx)).
		const a = normal( prev, p );
		const b = normal( p, next );
		const mx = - ( a[ 0 ] + b[ 0 ] );
		const mz = - ( a[ 1 ] + b[ 1 ] );
		const m = Math.hypot( mx, mz );

		if ( m < 1e-6 ) {

			inward.push( [ p[ 0 ] - a[ 0 ] * width, p[ 1 ] - a[ 1 ] * width ] );
			continue;

		}

		// Mitre length: width / cos(half angle), capped on sharp corners.
		const cosHalf = Math.max( 1 / MITRE_LIMIT, m / 2 );
		const along = width / cosHalf;
		inward.push( [ p[ 0 ] + ( mx / m ) * along, p[ 1 ] + ( mz / m ) * along ] );

	}

	const positions = [];
	const uvs = [];
	const normals = [];
	let run = 0;

	const kept = points.map( ( p, i ) => keep( p, points[ ( i + 1 ) % n ] ) );

	for ( let i = 0; i < n; i ++ ) {

		const p = points[ i ];
		const q = points[ ( i + 1 ) % n ];
		const length = Math.hypot( q[ 0 ] - p[ 0 ], q[ 1 ] - p[ 1 ] );

		if ( length < 1e-6 || ! kept[ i ] ) continue;

		// A corner shared with a kept neighbour is mitred; beside a skipped
		// edge the stone ends square on this edge's own normal.
		const own = normal( p, q );
		const pi = kept[ ( i + n - 1 ) % n ] ? inward[ i ] : [ p[ 0 ] - own[ 0 ] * width, p[ 1 ] - own[ 1 ] * width ];
		const qi = kept[ ( i + 1 ) % n ] ? inward[ ( i + 1 ) % n ] : [ q[ 0 ] - own[ 0 ] * width, q[ 1 ] - own[ 1 ] * width ];

		const u0 = run;
		const u1 = run + length;
		// Two triangles wound to face +Y.
		const quad = [
			[ p[ 0 ], p[ 1 ], u0, 0 ], [ pi[ 0 ], pi[ 1 ], u0, width ], [ q[ 0 ], q[ 1 ], u1, 0 ],
			[ q[ 0 ], q[ 1 ], u1, 0 ], [ pi[ 0 ], pi[ 1 ], u0, width ], [ qi[ 0 ], qi[ 1 ], u1, width ]
		];

		for ( const [ x, z, u, v ] of quad ) {

			positions.push( x, y, z );
			uvs.push( u, v );
			normals.push( 0, 1, 0 );

		}

		run = u1;

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( normals, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );

	return geometry;

}

/** Unit outward normal of the CCW ring edge a -> b. */
function normal( a, b ) {

	const dx = b[ 0 ] - a[ 0 ];
	const dz = b[ 1 ] - a[ 1 ];
	const length = Math.hypot( dx, dz ) || 1;

	return [ dz / length, - dx / length ];

}

/** The atlas roadway polygons, with a bounds test in front of the ring test. */
export class Roadway {

	constructor( ground ) {

		this.rings = ground
			.filter( ( cover ) => cover.surface === 'roadway' )
			.map( ( cover ) => ( { ring: cover.polygon, ...ringBounds( [ cover.polygon ] ) } ) );

	}

	covers( x, z ) {

		return this.rings.some( ( { ring, min, max } ) =>
			x >= min[ 0 ] && x <= max[ 0 ] && z >= min[ 1 ] && z <= max[ 1 ] && pointInRing( x, z, ring ) );

	}

	/** Whether the ring edge a -> b (of a ring wound `ccw` or not) has road just outside it. */
	bordersEdge( a, b, ccw, probe = 0.1 ) {

		const dx = b[ 0 ] - a[ 0 ];
		const dz = b[ 1 ] - a[ 1 ];
		const length = Math.hypot( dx, dz ) || 1;
		const sign = ccw ? 1 : - 1;
		const mx = ( a[ 0 ] + b[ 0 ] ) / 2 + ( dz / length ) * sign * probe;
		const mz = ( a[ 1 ] + b[ 1 ] ) / 2 - ( dx / length ) * sign * probe;

		return this.covers( mx, mz );

	}

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
