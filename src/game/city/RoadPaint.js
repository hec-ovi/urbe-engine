import * as THREE from 'three/webgpu';

/** How far a marking floats over the roadway, clear of z-fighting. */
export const PAINT_Y = 0.012;
/**
 * Traffic paint is paint: a warm off-white that returns whatever the lamps give
 * it and goes dark between them, which is what road markings do at night.
 * Anything emissive here would put a glowing line down a street whose whole
 * look depends on light coming from sources the world actually built.
 */
export const PAINT_COLOR = 0xd8d5c8;

/** The one material every marking on the roadway wears. */
export function paintMaterial() {

	return new THREE.MeshStandardMaterial( { color: PAINT_COLOR, roughness: 0.82, metalness: 0 } );

}

/**
 * A flat marking following a 2D polyline, facing +Y.
 * @param options.offset metres to the left of the line, in travel direction
 * @param options.width paint width
 * @param options.dash painted run in metres; 0 draws a solid line
 * @param options.gap unpainted run between dashes
 * @returns a BufferGeometry, or null when nothing was painted
 */
export function stripe( path, { offset = 0, width, y = PAINT_Y, dash = 0, gap = 0 } ) {

	const half = width / 2;
	const period = dash + gap;
	const positions = [];
	let travelled = 0;

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );

		if ( length < 1e-6 ) continue;

		const ux = dx / length;
		const uz = dz / length;
		// Connections' own left: lane index 0 is the rightmost of its direction
		// and its left neighbour sits this way.
		const lx = - uz;
		const lz = ux;

		for ( const [ from, to ] of painted( travelled, length, dash, period ) ) {

			const sx = ax + ux * from + lx * offset;
			const sz = az + uz * from + lz * offset;
			const ex = ax + ux * to + lx * offset;
			const ez = az + uz * to + lz * offset;
			const nx = lx * half;
			const nz = lz * half;

			// Wound so the face looks up: the left-hand offset above puts the
			// other order's normal into the ground, where nothing can see it.
			positions.push(
				sx + nx, y, sz + nz, ex - nx, y, ez - nz, sx - nx, y, sz - nz,
				sx + nx, y, sz + nz, ex + nx, y, ez + nz, ex - nx, y, ez - nz
			);

		}

		travelled += length;

	}

	if ( ! positions.length ) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();

	return geometry;

}

/**
 * The painted runs of one segment, in metres from its start. The dash pattern
 * is measured from the start of the whole line, so it never restarts at a bend.
 */
function painted( travelled, length, dash, period ) {

	if ( ! ( dash > 0 ) ) return [ [ 0, length ] ];

	const out = [];
	const end = travelled + length;

	for ( let s = Math.floor( travelled / period ) * period; s < end; s += period ) {

		const from = Math.max( s, travelled );
		const to = Math.min( s + dash, end );

		if ( to > from ) out.push( [ from - travelled, to - travelled ] );

	}

	return out;

}
