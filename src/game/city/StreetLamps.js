import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInRing } from '../ground/Polygons.js';
import { kelvinColor } from '../light/Color.js';

const SPACING = 19;
const PLAZA_SPACING = 34;
const MIN_GAP = 6;
const POLE_HEIGHT = 6.4;
const POLE_RADIUS = 0.085;
/** The pole is tapered; the collider is one cylinder around its widest point. */
const POLE_COLLIDER_RADIUS = 0.14;
const ARM = 1.1;
// A street luminaire, in the units three wants: luminous flux and the colour
// temperature of the lamp inside it. 12000 lm at 3000 K is a mid-power sodium
// head, which is what a street of this width carries.
const LAMP_LUMENS = 12000;
const LAMP_KELVIN = 3000;
const LAMP_RANGE = 26;
const LENS_KEY = 'cyberpunk/light-fixture/mid';
const POLE_KEY = 'cyberpunk/metal/rich';
/**
 * A lens is looked at directly, so it has to sit above the exposure the road
 * is judged at or it reads as painted plastic rather than as the source.
 */
const LENS_EMISSIVE = 90;

/**
 * Lamp posts along the streets, from the atlas street graph. One post every
 * 19 m, alternating sides, plus one on the widest corner of each crossing, and
 * never two within 6 m of each other, so overlapping street edges cannot stack
 * posts into a thicket. Open ground (plazas) carries no posts inside it, only
 * a sparse ring around its edge.
 *
 * Each post is pole, arm and a luminaire: a dark housing over the road with a
 * small emissive lens under it, and the fixture registered at the lens in
 * photometric units, so the light that lands on the road is the light the lamp
 * would really throw.
 */
export class StreetLamps {

	constructor( atlas, factory ) {

		this.atlas = atlas;
		this.factory = factory;

	}

	/** @returns { group, glows, posts } */
	build() {

		const plazas = this.atlas.volumetric.ground
			.filter( ( cover ) => cover.surface === 'open' )
			.map( ( cover ) => cover.polygon );

		const spots = dedupe( [ ...this.#alongStreets(), ...this.#atCrossings() ]
			.filter( ( spot ) => ! plazas.some( ( ring ) => pointInRing( spot.x, spot.z, ring ) ) )
			.concat( this.#aroundPlazas( plazas ) ) );

		const structure = [];
		const lenses = [];
		const glows = [];
		const posts = [];

		for ( const spot of spots ) this.#lamp( structure, lenses, glows, posts, spot );

		const group = new THREE.Group();
		group.name = 'lamps';

		if ( structure.length ) {

			group.add( new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( structure, false ),
				this.factory.build( POLE_KEY )
			) );

		}

		if ( lenses.length ) {

			group.add( new THREE.Mesh(
				BufferGeometryUtils.mergeGeometries( lenses, false ),
				this.factory.variant( LENS_KEY, {
					emissiveScale: LENS_EMISSIVE,
					emissive: kelvinColor( LAMP_KELVIN )
				} )
			) );

		}

		return { group, glows, posts };

	}

	/** One post every SPACING metres, alternating kerbs down each edge. */
	#alongStreets() {

		const spots = [];

		for ( const edge of this.atlas.streets.edges ) {

			const offset = edge.width / 2 + Math.max( 1.1, ( edge.sidewalk?.left ?? 2.5 ) * 0.45 );
			const points = samplePath( edge.path, SPACING );

			points.forEach( ( { point, normal }, i ) => {

				const side = i % 2 ? - 1 : 1;

				spots.push( {
					x: point.x + normal.x * offset * side,
					z: point.z + normal.z * offset * side,
					ax: - normal.x * side,
					az: - normal.z * side
				} );

			} );

		}

		return spots;

	}

	/** One post on the widest corner of every junction of three or more streets. */
	#atCrossings() {

		const spots = [];
		const paths = new Map( this.atlas.streets.edges.map( ( edge ) => [ edge.id, edge ] ) );

		for ( const node of this.atlas.streets.nodes ) {

			const edges = [ ...new Set( node.edgeIds ) ].map( ( id ) => paths.get( id ) ).filter( Boolean );

			if ( edges.length < 3 ) continue;

			const [ nx, nz ] = node.position;
			const angles = edges
				.map( ( edge ) => leaving( edge, nx, nz ) )
				.filter( Boolean )
				.map( ( d ) => Math.atan2( d[ 1 ], d[ 0 ] ) )
				.sort( ( a, b ) => a - b );

			if ( angles.length < 2 ) continue;

			// The widest angular gap between two streets is the open corner.
			let best = { gap: - 1, mid: 0 };

			for ( let i = 0; i < angles.length; i ++ ) {

				const a = angles[ i ];
				const b = angles[ ( i + 1 ) % angles.length ] + ( i + 1 === angles.length ? Math.PI * 2 : 0 );

				if ( b - a > best.gap ) best = { gap: b - a, mid: ( a + b ) / 2 };

			}

			const reach = Math.max( ...edges.map( ( edge ) => edge.width ) ) / 2 + 2.2;
			const dx = Math.cos( best.mid );
			const dz = Math.sin( best.mid );

			spots.push( { x: nx + dx * reach, z: nz + dz * reach, ax: - dx, az: - dz } );

		}

		return spots;

	}

	/** Plazas get a ring of posts around the edge and nothing in the middle. */
	#aroundPlazas( plazas ) {

		const spots = [];

		for ( const ring of plazas ) {

			for ( const { point, normal } of samplePath( [ ...ring, ring[ 0 ] ], PLAZA_SPACING ) ) {

				spots.push( { x: point.x, z: point.z, ax: normal.x, az: normal.z } );

			}

		}

		return spots;

	}

	/**
	 * Pole, arm reaching over the road, dark housing on the end of it and the
	 * lens under the housing. The glow hangs just below the lens, and the pole
	 * is the only part solid enough to walk into.
	 */
	#lamp( structure, lenses, glows, posts, { x, z, ax, az } ) {

		const base = 0.12;
		const facing = - Math.atan2( az, ax );

		const pole = new THREE.CylinderGeometry( POLE_RADIUS, POLE_RADIUS * 1.5, POLE_HEIGHT, 6, 1 );
		pole.translate( x, base + POLE_HEIGHT / 2, z );
		structure.push( strip( pole ) );

		const arm = new THREE.CylinderGeometry( POLE_RADIUS * 0.7, POLE_RADIUS * 0.7, ARM, 5, 1 );
		arm.rotateZ( Math.PI / 2 );
		arm.rotateY( facing );
		arm.translate( x + ax * ARM / 2, base + POLE_HEIGHT - 0.1, z + az * ARM / 2 );
		structure.push( strip( arm ) );

		const hx = x + ax * ARM;
		const hz = z + az * ARM;
		const headY = base + POLE_HEIGHT - 0.24;

		const housing = new THREE.BoxGeometry( 0.34, 0.16, 0.66 );
		housing.rotateY( facing );
		housing.translate( hx, headY, hz );
		structure.push( strip( housing ) );

		const lens = new THREE.BoxGeometry( 0.26, 0.05, 0.54 );
		lens.rotateY( facing );
		lens.translate( hx, headY - 0.1, hz );
		lenses.push( strip( lens ) );

		glows.push( {
			position: new THREE.Vector3( hx, headY - 0.2, hz ),
			color: kelvinColor( LAMP_KELVIN ),
			lumens: LAMP_LUMENS,
			range: LAMP_RANGE
		} );

		posts.push( { x, z, base, height: POLE_HEIGHT, radius: POLE_COLLIDER_RADIUS } );

	}

}

/** Points every `step` metres along a polyline, with the left-hand normal. */
export function samplePath( path, step ) {

	const out = [];
	let carry = step / 2;

	for ( let i = 0; i < path.length - 1; i ++ ) {

		const [ ax, az ] = path[ i ];
		const [ bx, bz ] = path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot( dx, dz );

		if ( length < 1e-6 ) continue;

		const ux = dx / length;
		const uz = dz / length;
		const normal = new THREE.Vector3( uz, 0, - ux );

		for ( let d = carry; d < length; d += step ) {

			out.push( { point: new THREE.Vector3( ax + ux * d, 0, az + uz * d ), normal } );

		}

		carry = Math.max( 0, carry - length ) || step - ( ( length - carry ) % step );

	}

	return out;

}

/** Unit direction of an edge leaving [x, z], or null when it starts elsewhere. */
function leaving( edge, x, z ) {

	const near = ( p ) => Math.hypot( p[ 0 ] - x, p[ 1 ] - z ) < 1;
	const path = edge.path;
	const pair = near( path[ 0 ] )
		? [ path[ 0 ], path[ 1 ] ]
		: near( path[ path.length - 1 ] ) ? [ path[ path.length - 1 ], path[ path.length - 2 ] ] : null;

	if ( ! pair ) return null;

	const dx = pair[ 1 ][ 0 ] - pair[ 0 ][ 0 ];
	const dz = pair[ 1 ][ 1 ] - pair[ 0 ][ 1 ];
	const length = Math.hypot( dx, dz );

	return length < 1e-6 ? null : [ dx / length, dz / length ];

}

/**
 * Drops posts that land within MIN_GAP of one already placed, which is what
 * keeps overlapping street edges from stacking a thicket on one corner. The
 * grid is only there to keep the check local.
 */
function dedupe( spots ) {

	const grid = new Map();
	const out = [];

	for ( const spot of spots ) {

		const cx = Math.floor( spot.x / MIN_GAP );
		const cz = Math.floor( spot.z / MIN_GAP );
		let clear = true;

		for ( let dx = - 1; dx <= 1 && clear; dx ++ ) {

			for ( let dz = - 1; dz <= 1 && clear; dz ++ ) {

				for ( const other of grid.get( `${cx + dx}:${cz + dz}` ) ?? [] ) {

					if ( Math.hypot( other.x - spot.x, other.z - spot.z ) < MIN_GAP ) clear = false;

				}

			}

		}

		if ( ! clear ) continue;

		const cell = `${cx}:${cz}`;
		if ( ! grid.has( cell ) ) grid.set( cell, [] );
		grid.get( cell ).push( spot );
		out.push( spot );

	}

	return out;

}

/** Primitive geometries carry uv sets we never use; drop everything but the basics. */
function strip( geometry ) {

	geometry.deleteAttribute( 'uv1' );

	return geometry.index ? geometry.toNonIndexed() : geometry;

}
