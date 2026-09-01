import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';

const CORE_WIDTH = 0.16;
const BLOOM_WIDTH = 1.4;
const CORE_Y = 0.02;
const BLOOM_Y = 0.015;
const COLORS = [ 0x28e6ff, 0xff2fb0 ];

/**
 * The lit lane markings that run down the middle of the road: a hard emissive
 * core with a wide additive bloom under it, which is what reads as neon
 * reflected in wet asphalt without paying for screen-space reflections.
 * Geometry follows the connections lane centrelines, so the light is on the
 * road the cars actually drive.
 */
export class LaneGlow {

	constructor( networks ) {

		this.networks = networks;

	}

	build() {

		const cores = [ [], [] ];
		const blooms = [ [], [] ];

		for ( const lane of this.networks.road.lanes ) {

			const channel = lane.index % 2;
			cores[ channel ].push( ribbon( lane.path, CORE_WIDTH, CORE_Y ) );
			blooms[ channel ].push( ribbon( lane.path, BLOOM_WIDTH, BLOOM_Y ) );

		}

		const group = new THREE.Group();
		group.name = 'lane-glow';

		for ( let channel = 0; channel < COLORS.length; channel ++ ) {

			const color = COLORS[ channel ];

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

		return group;

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
