import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { PAINT_Y, paintMaterial, stripe } from './RoadPaint.js';

const PAINT_WIDTH = 0.12;
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

		group.add( new THREE.Mesh( BufferGeometryUtils.mergeGeometries( painted, false ), paintMaterial() ) );

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
