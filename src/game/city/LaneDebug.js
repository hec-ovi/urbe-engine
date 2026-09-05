import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { stripe } from './LaneDebugGeometry.js';

const GLOW_WIDTH = 0.06;
const GLOW_Y = 0.012;
const GLOW_COLOR = 0x1c7684;

const DEBUG_CORE_WIDTH = 0.16;
const DEBUG_BLOOM_WIDTH = 1.4;
const DEBUG_CORE_Y = 0.02;
const DEBUG_BLOOM_Y = 0.015;
const DEBUG_COLORS = [ 0x28e6ff, 0xff2fb0 ];

/** Diagnostic centerlines from authoritative movement paths. */
export class LaneDebug {

	/** @param mode 'glow' | 'debug' */
	constructor( networks, mode ) {

		this.networks = networks;
		this.mode = mode;

	}

	build() {

		const group = new THREE.Group();
		group.name = 'lane-debug';

		if ( this.mode === 'debug' ) this.#bands( group );
		else if ( this.mode === 'glow' ) this.#glow( group );

		return group;

	}

	/** Debug only: the thin emissive strip down each lane centreline. */
	#glow( group ) {

		const strips = this.networks.road.lanes
			.map( ( lane ) => stripe( path3( lane ), { width: GLOW_WIDTH, y: GLOW_Y } ) )
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
			const path = path3( lane );
			const core = stripe( path, { width: DEBUG_CORE_WIDTH, y: DEBUG_CORE_Y } );
			const bloom = stripe( path, { width: DEBUG_BLOOM_WIDTH, y: DEBUG_BLOOM_Y } );

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

function path3( lane ) {

	if ( ! Array.isArray( lane.path3 ) || lane.path3.length < 2 || lane.path3.some( ( point ) =>
		! Array.isArray( point ) || point.length !== 3 || point.some( ( value ) => ! Number.isFinite( value ) ) ) ) {

		const error = new Error( `E_MOVEMENT_PATH3: road lane ${lane.id}.path3 must be an authoritative 3D path` );
		error.code = 'E_MOVEMENT_PATH3';
		throw error;

	}

	return lane.path3;

}
