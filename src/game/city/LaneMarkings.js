import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const PAINT_WIDTH = 0.12;
const PAINT_Y = 0.012;
// Traffic paint, not a light: a warm off-white with just enough emission to
// stay readable on the stretch between two lamps, where real paint would be
// answering headlights this renderer has no way to bounce back.
const PAINT_COLOR = 0xd8d5c8;
const PAINT_EMISSIVE = 0x6a6a60;
const DASH = 3;
const DASH_GAP = 6;
/** Half the gap between the two halves of a centre line. */
const CENTRE_INSET = 0.09;

const GLOW_WIDTH = 0.06;
const GLOW_Y = 0.012;
const GLOW_COLOR = 0x1c7684;

const DEBUG_CORE_WIDTH = 0.16;
const DEBUG_BLOOM_WIDTH = 1.4;
const DEBUG_CORE_Y = 0.02;
const DEBUG_BLOOM_Y = 0.015;
const DEBUG_COLORS = [ 0x28e6ff, 0xff2fb0 ];

/**
 * Road paint, laid on the boundaries of the connections lane graph so it lands
 * where the cars actually drive. Every lane paints its own left boundary: a
 * broken white line where the lane it shares that boundary with runs the same
 * way, and half of a solid double centre line where it does not, which is the
 * boundary against oncoming traffic.
 *
 * Two debug views replace it: `glow` restores the teal emissive centreline
 * strips, `debug` paints every lane end to end in one of two colours by lane
 * index, which is how to see the graph itself.
 */
export class LaneMarkings {

	/** @param mode 'paint' (default) | 'glow' | 'debug' */
	constructor( networks, mode = 'paint' ) {

		this.networks = networks;
		this.mode = mode;

	}

	build() {

		const group = new THREE.Group();
		group.name = 'lane-markings';

		if ( this.mode === 'debug' ) this.#bands( group );
		else if ( this.mode === 'glow' ) this.#glow( group );
		else this.#paint( group );

		return group;

	}

	/** Broken lane lines and solid centre lines, all one draw call. */
	#paint( group ) {

		const stripes = [];

		for ( const lane of this.networks.road.lanes ) {

			const half = lane.width / 2;

			stripes.push( lane.left
				? stripe( lane.path, { offset: half, width: PAINT_WIDTH, y: PAINT_Y, dash: DASH, gap: DASH_GAP } )
				: stripe( lane.path, { offset: half - CENTRE_INSET, width: PAINT_WIDTH, y: PAINT_Y } ) );

		}

		const painted = stripes.filter( ( geometry ) => geometry !== null );

		if ( ! painted.length ) return;

		group.add( new THREE.Mesh(
			BufferGeometryUtils.mergeGeometries( painted, false ),
			new THREE.MeshStandardMaterial( {
				color: PAINT_COLOR,
				emissive: PAINT_EMISSIVE,
				roughness: 0.82,
				metalness: 0
			} )
		) );

	}

	/** Debug only: the thin emissive strip down each lane centreline. */
	#glow( group ) {

		const strips = this.networks.road.lanes
			.map( ( lane ) => stripe( lane.path, { width: GLOW_WIDTH, y: GLOW_Y } ) )
			.filter( ( geometry ) => geometry !== null );

		if ( ! strips.length ) return;

		group.add( new THREE.Mesh(
			BufferGeometryUtils.mergeGeometries( strips, false ),
			new THREE.MeshBasicMaterial( { color: GLOW_COLOR } )
		) );

	}

	/** Debug only: every lane painted end to end, coloured by lane index. */
	#bands( group ) {

		const cores = [ [], [] ];
		const blooms = [ [], [] ];

		for ( const lane of this.networks.road.lanes ) {

			const channel = lane.index % 2;
			const core = stripe( lane.path, { width: DEBUG_CORE_WIDTH, y: DEBUG_CORE_Y } );
			const bloom = stripe( lane.path, { width: DEBUG_BLOOM_WIDTH, y: DEBUG_BLOOM_Y } );

			if ( core ) cores[ channel ].push( core );
			if ( bloom ) blooms[ channel ].push( bloom );

		}

		for ( let channel = 0; channel < DEBUG_COLORS.length; channel ++ ) {

			const color = DEBUG_COLORS[ channel ];

			if ( cores[ channel ].length ) {

				group.add( new THREE.Mesh(
					BufferGeometryUtils.mergeGeometries( cores[ channel ], false ),
					new THREE.MeshBasicMaterial( { color, toneMapped: false } )
				) );

			}

			if ( blooms[ channel ].length ) {

				group.add( new THREE.Mesh(
					BufferGeometryUtils.mergeGeometries( blooms[ channel ], false ),
					new THREE.MeshBasicMaterial( {
						color,
						transparent: true,
						opacity: 0.16,
						blending: THREE.AdditiveBlending,
						depthWrite: false,
						toneMapped: false
					} )
				) );

			}

		}

	}

}

/**
 * A flat marking following a 2D polyline, facing +Y.
 * @param options.offset metres to the left of the line, in travel direction
 * @param options.width paint width
 * @param options.dash painted run in metres; 0 draws a solid line
 * @param options.gap unpainted run between dashes
 * @returns a BufferGeometry, or null when nothing was painted
 */
export function stripe( path, { offset = 0, width, y, dash = 0, gap = 0 } ) {

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
