import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const STRIP_WIDTH = 0.06;
const STRIP_Y = 0.012;
const STRIP_COLOR = 0x1c7684;

const DEBUG_CORE_WIDTH = 0.16;
const DEBUG_BLOOM_WIDTH = 1.4;
const DEBUG_CORE_Y = 0.02;
const DEBUG_BLOOM_Y = 0.015;
const DEBUG_COLORS = [ 0x28e6ff, 0xff2fb0 ];

/**
 * The lane markings down the middle of the road: one thin emissive strip per
 * lane centreline, dim enough to read as a painted line catching the neon
 * rather than a lit band over the asphalt. Geometry follows the connections
 * lane centrelines, so the marking is on the road the cars actually drive.
 *
 * `debug` swaps in the lane-graph view instead: the full lane painted in one
 * of two colours by lane index, which is how to see the graph itself.
 */
export class LaneGlow {

	/** @param debug true draws the full-width lane bands instead of the strips */
	constructor( networks, debug = false ) {

		this.networks = networks;
		this.debug = debug;

	}

	build() {

		const group = new THREE.Group();
		group.name = 'lane-glow';

		if ( this.debug ) this.#bands( group );
		else this.#strips( group );

		return group;

	}

	#strips( group ) {

		const strips = this.networks.road.lanes.map(
			( lane ) => ribbon( lane.path, STRIP_WIDTH, STRIP_Y )
		);

		if ( ! strips.length ) return;

		group.add( new THREE.Mesh(
			BufferGeometryUtils.mergeGeometries( strips, false ),
			new THREE.MeshBasicMaterial( { color: STRIP_COLOR } )
		) );

	}

	/** Debug only: every lane painted end to end, coloured by lane index. */
	#bands( group ) {

		const cores = [ [], [] ];
		const blooms = [ [], [] ];

		for ( const lane of this.networks.road.lanes ) {

			const channel = lane.index % 2;
			cores[ channel ].push( ribbon( lane.path, DEBUG_CORE_WIDTH, DEBUG_CORE_Y ) );
			blooms[ channel ].push( ribbon( lane.path, DEBUG_BLOOM_WIDTH, DEBUG_BLOOM_Y ) );

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

/** A flat strip of constant width following a 2D polyline, facing +Y. */
function ribbon( path, width, y ) {

	const half = width / 2;
	const positions = [];

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );

		if ( length < 1e-6 ) continue;

		const nx = ( dz / length ) * half;
		const nz = ( - dx / length ) * half;

		const a0 = [ ax + nx, y, az + nz ];
		const a1 = [ ax - nx, y, az - nz ];
		const b0 = [ bx + nx, y, bz + nz ];
		const b1 = [ bx - nx, y, bz - nz ];

		positions.push( ...a0, ...a1, ...b1, ...a0, ...b1, ...b0 );

	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );

	return geometry;

}
