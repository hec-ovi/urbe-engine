import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { pointInRing, Roadway } from '../ground/Polygons.js';
import { kelvinColor } from '../light/Color.js';

const SPACING = 19;
const PLAZA_SPACING = 34;
const MIN_GAP = 6;
const POLE_HEIGHT = 6.4;
const POLE_RADIUS = 0.085;
/** The pole is tapered; the collider is one cylinder around its widest point. */
const POLE_COLLIDER_RADIUS = 0.14;
const BEND_RADIUS = 0.36;
const ARM_REACH = 0.72;
const HEAD_LENGTH = 1.65;
const HEAD_WIDTH = 0.22;
const HEAD_HEIGHT = 0.13;
const LENS_SEGMENTS = 5;
const LENS_LENGTH = 0.28;
const LENS_WIDTH = 0.16;
const LENS_GAP = 0.035;
// A street luminaire, in the units three wants: luminous flux and the colour
// temperature of the lamp inside it. 12000 lm at 3800 K is a neutral mid-power
// LED head, which keeps concrete and road boundaries readable at night.
const LAMP_LUMENS = 12000;
const LAMP_KELVIN = 3800;
const LAMP_RANGE = 26;
const LENS_KEY = 'cyberpunk/light-fixture/mid';
const POLE_KEY = 'cyberpunk/metal/rich';
/**
 * A lens is looked at directly, so it has to sit above the exposure the road
 * is judged at or it reads as painted plastic rather than as the source.
 */
const LENS_EMISSIVE = 270;

// A wall pack over a service door: 3000 lm is a 30 W LED head, a quarter of the
// street luminaire's flux, on the same lamp colour so an alley reads as part of
// the same city. Equal illuminance at a quarter of the flux is half the reach,
// which is where the 13 m comes from.
export const WALL_LUMENS = 3000;
const WALL_RANGE = 13;
/** Above a doorway, below the first-floor windows. */
const WALL_HEIGHT = 4;
/** A dark spot further than this from a facade gets no fixture: nothing floats. */
const MOUNT_REACH = 10;
/** Each pack covers metres of the leg it lights, so no leg can need more than a few. */
const PACKS_PER_LEG = 32;
/** How far the lens stands off the wall, on its bracket. */
const BRACKET_OUT = 0.16;

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
 *
 * A 6.4 m pole with a 1.1 m arm does not fit a 5 m pedestrian alley, so alleys
 * take no post. Once the posts stand, every walkable segment the city has is
 * measured against what they actually reach, and each stretch none of them
 * reaches gets a wall pack bracketed to a real building face beside it. The
 * pack merges into the same two meshes the posts do, so covering the dark ends
 * of the city costs no draw call.
 */
export class StreetLamps {

	/** @param walk `networks.walk` per ../../../../connections/CONTRACT.md; without it, posts only. */
	constructor( atlas, factory, walk = null ) {

		this.atlas = atlas;
		this.factory = factory;
		this.walk = walk;

	}

	/** @returns { group, glows, posts } */
	build() {

		const plazas = this.atlas.volumetric.ground
			.filter( ( cover ) => cover.surface === 'open' )
			.map( ( cover ) => cover.polygon );
		const roadway = new Roadway( this.atlas.volumetric.ground );

		// An alley is a few metres of pavement between two walls, so a 6.4 m pole
		// with an arm over it would stand in the middle of the only way through,
		// whether it is the alley's own post or a junction post that landed in
		// its mouth. The coverage pass lights these off the walls instead.
		const alleys = this.atlas.streets.edges.filter( ( edge ) => edge.class === 'alley' );

		// A post stands on the kerb side of the roadway edge the atlas drew, never
		// on the asphalt: where a junction or a wide road swallows the offset
		// spot, the post steps back out of it or is left out.
		const spots = dedupe( [ ...this.#alongStreets(), ...this.#atCrossings() ]
			.filter( ( spot ) => ! plazas.some( ( ring ) => pointInRing( spot.x, spot.z, ring ) ) )
			.concat( this.#aroundPlazas( plazas ) )
			.filter( ( spot ) => ! alleys.some( ( alley ) => onPavementOf( spot, alley ) ) )
			.map( ( spot ) => offAsphalt( roadway, spot ) )
			.filter( Boolean ) );

		const structure = [];
		const lenses = [];
		const glows = [];
		const posts = [];

		for ( const spot of spots ) this.#lamp( structure, lenses, glows, posts, spot );

		this.#cover( structure, lenses, glows );

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
					variantId: 'panel',
					emissiveLevel: LENS_EMISSIVE,
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
	 * The coverage rule: no walkable segment is left with nothing on it, not
	 * even the dim edge of a lamp. Every segment the city publishes is measured
	 * against what the posts actually reach, and each stretch none of them
	 * reaches takes a wall pack on the facade beside it.
	 */
	#cover( structure, lenses, glows ) {

		if ( ! this.walk ) return;

		const reach = new Reach( LAMP_RANGE );

		for ( const glow of glows ) reach.add( glow.position.x, glow.position.z, glow.range );

		for ( const edge of this.walk.edges ) {

			// A `link` walk edge is a bridge or a tunnel: it runs inside a
			// structure of its own, over the street or under it, and no fixture
			// on a facade at 4 m is lighting either of them.
			if ( edge.kind === 'link' ) continue;

			for ( let i = 0; i < edge.path.length - 1; i ++ ) {

				this.#coverLeg( structure, lenses, glows, reach, edge.path[ i ], edge.path[ i + 1 ] );

			}

		}

	}

	/**
	 * One straight leg of a walkable segment, lit end to end. The stretches no
	 * fixture reaches are exact intervals along the leg, and the darkest end of
	 * the first one takes a pack, until nothing is left uncovered. A stretch
	 * with no building within reach stays dark rather than growing a fixture in
	 * mid-air.
	 */
	#coverLeg( structure, lenses, glows, reach, [ ax, az ], [ bx, bz ] ) {

		const length = Math.hypot( bx - ax, bz - az );

		if ( length < 1e-6 ) return;

		const ux = ( bx - ax ) / length;
		const uz = ( bz - az ) / length;

		for ( let i = 0; i < PACKS_PER_LEG; i ++ ) {

			const gap = reach.gaps( ax, az, ux, uz, length )[ 0 ];

			if ( ! gap ) return;

			// Just inside the dark end, so the pack lands on the stretch it has
			// to light and the next round starts further down the leg.
			const at = Math.min( gap[ 0 ] + 0.5, ( gap[ 0 ] + gap[ 1 ] ) / 2 );
			const wall = this.#facadeFacing( ax + ux * at, az + uz * at );

			if ( ! wall ) return;

			const fixture = this.#wallPack( structure, lenses, glows, wall );
			reach.add( fixture.position.x, fixture.position.z, fixture.range );

		}

	}

	/**
	 * The building face nearest a dark spot and actually turned towards it.
	 * Footprints are counter-clockwise, so a segment's outward normal is
	 * (dz, -dx); a face pointing the other way is the back of a wall on the far
	 * side of its own block, and mounting there would light the wrong street.
	 */
	#facadeFacing( x, z ) {

		let best = null;

		for ( const parcel of this.atlas.parcels ) {

			const ring = parcel.footprint;

			for ( let i = 0; i < ring.length; i ++ ) {

				const [ ax, az ] = ring[ i ];
				const [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
				const dx = bx - ax;
				const dz = bz - az;
				const length = Math.hypot( dx, dz );

				if ( length < 1e-6 ) continue;

				const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( length * length ) ) );
				const px = ax + dx * t;
				const pz = az + dz * t;
				const distance = Math.hypot( x - px, z - pz );

				if ( distance > MOUNT_REACH || ( best && distance >= best.distance ) ) continue;

				const nx = dz / length;
				const nz = - dx / length;

				if ( ( x - px ) * nx + ( z - pz ) * nz <= 0 ) continue;

				best = { distance, px, pz, nx, nz };

			}

		}

		return best;

	}

	/**
	 * A bracket on the wall and the pack in front of it, both merged into the
	 * same two meshes the posts build, so coverage costs no draw call. The
	 * fixture is registered at the lens in the same photometric units.
	 */
	#wallPack( structure, lenses, glows, { px, pz, nx, nz } ) {

		const facing = - Math.atan2( nz, nx );

		const bracket = new THREE.BoxGeometry( BRACKET_OUT, 0.1, 0.12 );
		bracket.rotateY( facing );
		bracket.translate( px + nx * BRACKET_OUT / 2, WALL_HEIGHT, pz + nz * BRACKET_OUT / 2 );
		structure.push( strip( bracket ) );

		const lens = new THREE.BoxGeometry( 0.1, 0.14, 0.34 );
		lens.rotateY( facing );
		lens.translate( px + nx * ( BRACKET_OUT + 0.05 ), WALL_HEIGHT - 0.02, pz + nz * ( BRACKET_OUT + 0.05 ) );
		lenses.push( strip( lens ) );

		const glow = {
			position: new THREE.Vector3(
				px + nx * ( BRACKET_OUT + 0.16 ),
				WALL_HEIGHT - 0.1,
				pz + nz * ( BRACKET_OUT + 0.16 )
			),
			color: kelvinColor( LAMP_KELVIN ),
			lumens: WALL_LUMENS,
			range: WALL_RANGE
		};

		glows.push( glow );

		return glow;

	}

	/**
	 * Pole, arm reaching over the road, dark housing on the end of it and the
	 * lens under the housing. The glow hangs just below the lens, and the pole
	 * is the only part solid enough to walk into.
	 */
	#lamp( structure, lenses, glows, posts, { x, z, ax, az } ) {

		const assembly = streetLampAssembly( { x, z, ax, az } );
		structure.push( ...assembly.structure );
		lenses.push( ...assembly.lenses );
		glows.push( assembly.glow );
		posts.push( assembly.post );

	}

}

/**
 * One complete overhead fixture in the local frame of the route it serves.
 * The support bends from world up into `aim`; the housing and every diffuser
 * segment use that same axis. Only the fitted underside faces emit.
 */
export function streetLampAssembly( { x, z, ax, az } ) {

	const base = 0.12;
	const aimLength = Math.hypot( ax, az ) || 1;
	ax /= aimLength;
	az /= aimLength;
	const facing = - Math.atan2( az, ax );
	const headY = base + POLE_HEIGHT - HEAD_HEIGHT / 2;
	const straightHeight = POLE_HEIGHT - BEND_RADIUS - HEAD_HEIGHT / 2;
	const structure = [];
	const lenses = [];

	const pole = new THREE.CylinderGeometry( POLE_RADIUS, POLE_RADIUS * 1.5, straightHeight, 8, 1 );
	pole.translate( x, base + straightHeight / 2, z );
	structure.push( strip( pole ) );

	const bend = new THREE.TubeGeometry( new THREE.QuadraticBezierCurve3(
		new THREE.Vector3( 0, base + straightHeight, 0 ),
		new THREE.Vector3( 0, headY, 0 ),
		new THREE.Vector3( BEND_RADIUS, headY, 0 )
	), 8, POLE_RADIUS * 0.72, 6, false );
	bend.rotateY( facing );
	bend.translate( x, 0, z );
	structure.push( strip( bend ) );

	const armLength = ARM_REACH - BEND_RADIUS;
	const arm = new THREE.CylinderGeometry( POLE_RADIUS * 0.72, POLE_RADIUS * 0.72, armLength, 6, 1 );
	arm.rotateZ( Math.PI / 2 );
	arm.rotateY( facing );
	arm.translate(
		x + ax * ( BEND_RADIUS + armLength / 2 ),
		headY,
		z + az * ( BEND_RADIUS + armLength / 2 )
	);
	structure.push( strip( arm ) );

	// The socket enters the housing by half a segment. This is a fitted join,
	// rather than the old compact head balanced across the arm at 90 degrees.
	const headAlong = ARM_REACH + HEAD_LENGTH / 2 - LENS_LENGTH / 2;
	const hx = x + ax * headAlong;
	const hz = z + az * headAlong;
	const housing = new THREE.BoxGeometry( HEAD_LENGTH, HEAD_HEIGHT, HEAD_WIDTH );
	housing.rotateY( facing );
	housing.translate( hx, headY, hz );
	structure.push( strip( housing ) );

	const lensRun = LENS_SEGMENTS * LENS_LENGTH + ( LENS_SEGMENTS - 1 ) * LENS_GAP;

	for ( let i = 0; i < LENS_SEGMENTS; i ++ ) {

		const offset = - lensRun / 2 + LENS_LENGTH / 2 + i * ( LENS_LENGTH + LENS_GAP );
		const lens = new THREE.PlaneGeometry( LENS_LENGTH, LENS_WIDTH );
		fixtureUv( lens );
		// PlaneGeometry faces +Z. Rotate its face to -Y, then turn its long
		// dimension from local +X into the route-facing aim.
		lens.rotateX( Math.PI / 2 );
		lens.rotateY( facing );
		lens.translate( hx + ax * offset, headY - HEAD_HEIGHT / 2 - 0.001, hz + az * offset );
		lenses.push( lens.toNonIndexed() );

	}

	const glow = {
		position: new THREE.Vector3( hx, headY - HEAD_HEIGHT / 2 - 0.12, hz ),
		color: kelvinColor( LAMP_KELVIN ),
		lumens: LAMP_LUMENS,
		range: LAMP_RANGE
	};
	const post = {
		x, z, base, height: straightHeight, radius: POLE_COLLIDER_RADIUS,
		head: {
			center: new THREE.Vector3( hx, headY, hz ),
			aim: new THREE.Vector3( ax, 0, az ),
			length: HEAD_LENGTH,
			width: HEAD_WIDTH,
			underside: headY - HEAD_HEIGHT / 2
		}
	};

	return { structure, lenses, glow, post };

}

/** One 0.16 x 0.28 material tile fitted to one 0.16 x 0.28 diffuser face. */
function fixtureUv( geometry ) {

	const uv = geometry.getAttribute( 'uv' );

	for ( let i = 0; i < uv.count; i ++ ) {

		const u = uv.getX( i );
		const v = uv.getY( i );
		uv.setXY( i, v * LENS_WIDTH, u * LENS_LENGTH );

	}

	return geometry;

}

/** How far a spot on the asphalt is walked back toward its kerb before it is given up. */
const KERB_SEARCH = 4;
const KERB_STEP = 0.5;

/**
 * The spot itself when it stands clear of the asphalt, else the first point
 * behind it (away from the road its arm faces) that does, else null.
 */
function offAsphalt( roadway, spot ) {

	for ( let back = 0; back <= KERB_SEARCH; back += KERB_STEP ) {

		const x = spot.x - spot.ax * back;
		const z = spot.z - spot.az * back;

		if ( ! roadway.covers( x, z ) ) return back ? { ...spot, x, z } : spot;

	}

	return null;

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

/**
 * What a set of fixtures leaves dark along a line. A fixture covers the part of
 * a line inside its own range, which is an exact interval, so the stretches
 * nothing reaches are what is left over when those intervals are merged. The
 * grid cell is the widest range in the set, which is what keeps a query to the
 * cells around the line however many lamps the city ends up with.
 */
class Reach {

	constructor( cell ) {

		this.cell = cell;
		this.cells = new Map();

	}

	add( x, z, range ) {

		const key = `${Math.floor( x / this.cell )}:${Math.floor( z / this.cell )}`;

		if ( ! this.cells.has( key ) ) this.cells.set( key, [] );

		this.cells.get( key ).push( { x, z, range } );

	}

	/** @returns the uncovered intervals of the line, as [from, to] distances along it. */
	gaps( ax, az, ux, uz, length ) {

		const spans = [];

		for ( const light of this.#around( ax, az, ax + ux * length, az + uz * length ) ) {

			const dx = light.x - ax;
			const dz = light.z - az;
			const along = dx * ux + dz * uz;
			const half = light.range * light.range - ( dx * dx + dz * dz - along * along );

			if ( half > 0 ) spans.push( [ along - Math.sqrt( half ), along + Math.sqrt( half ) ] );

		}

		spans.sort( ( a, b ) => a[ 0 ] - b[ 0 ] );

		const gaps = [];
		let at = 0;

		for ( const [ from, to ] of spans ) {

			if ( from > at ) gaps.push( [ at, Math.min( from, length ) ] );

			at = Math.max( at, to );

			if ( at >= length ) return gaps;

		}

		gaps.push( [ at, length ] );

		return gaps;

	}

	/** Every fixture filed near the box the line spans, one cell of slack around it. */
	#around( ax, az, bx, bz ) {

		const found = [];
		const x0 = Math.floor( Math.min( ax, bx ) / this.cell ) - 1;
		const x1 = Math.floor( Math.max( ax, bx ) / this.cell ) + 1;
		const z0 = Math.floor( Math.min( az, bz ) / this.cell ) - 1;
		const z1 = Math.floor( Math.max( az, bz ) / this.cell ) + 1;

		for ( let cx = x0; cx <= x1; cx ++ ) {

			for ( let cz = z0; cz <= z1; cz ++ ) {

				for ( const light of this.cells.get( `${cx}:${cz}` ) ?? [] ) found.push( light );

			}

		}

		return found;

	}

}

/** Whether a spot stands on the pavement a street edge covers, kerb to kerb. */
function onPavementOf( spot, edge ) {

	const half = edge.width / 2 + Math.max( edge.sidewalk?.left ?? 0, edge.sidewalk?.right ?? 0 );

	for ( let i = 0; i < edge.path.length - 1; i ++ ) {

		const [ ax, az ] = edge.path[ i ];
		const [ bx, bz ] = edge.path[ i + 1 ];
		const dx = bx - ax;
		const dz = bz - az;
		const t = Math.max( 0, Math.min( 1, ( ( spot.x - ax ) * dx + ( spot.z - az ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );

		if ( Math.hypot( spot.x - ( ax + dx * t ), spot.z - ( az + dz * t ) ) < half ) return true;

	}

	return false;

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
