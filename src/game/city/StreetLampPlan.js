import * as THREE from 'three/webgpu';
import { pointInRing } from '../ground/Polygons.js';
import { StreetLampClearance } from './StreetLampClearance.js';
import { StreetLampSeats } from './StreetLampSeats.js';
import { StreetFixtureIndex } from './StreetFixtureIndex.js';
import { streetLampDescriptor, wallPackDescriptor, LAMP_RADIUS as POLE_COLLIDER_RADIUS, LAMP_REACH } from './StreetLampModel.js';
import { Reach } from './StreetLampReach.js';

const SPACING = 19, PLAZA_SPACING = 34, PLAZA_INSET = 0.75, MIN_GAP = 6;
const MOUNT_REACH = 10, PACKS_PER_LEG = 32;
/** A walk segment between these heights runs at grade, as the pole clearance counts it. */
const GRADE_BELOW = - 1, GRADE_ABOVE = 2;
/** Metres of one walk route on open ground, counted a metre at a time, beyond which it walks there rather than touches it. */
const WALKED_ON = 2;

/** Source-ordered placement planning with local exact clearance queries. */
export class StreetLampPlan {

	constructor( atlas, walk ) {

		this.atlas = atlas; this.walk = walk;
		this.records = []; this.posts = []; this.glows = [];

	}

	*steps() {

		const clearance = new StreetLampClearance( this.atlas, this.walk );
		yield* clearance.index();
		const roadway = new StreetFixtureIndex(), plazas = new StreetFixtureIndex(), alleys = new StreetFixtureIndex(), walked = new StreetFixtureIndex();
		this.facades = new StreetFixtureIndex();
		// Atlas's open ground is a block's unbuilt land as well as a square:
		// courtyards, leftover lot strips and the fringe past the outer streets.
		// Open land is a plaza, with its ring of posts, only where a walk route
		// runs on it; all of it keeps street posts out.
		for ( const edge of this.walk?.edges ?? [] ) { if ( edge.kind !== 'link' ) walked.add( edge, edge.path ); yield; }
		const plazaRings = [];
		for ( const cover of this.atlas.volumetric.ground ) {
			if ( cover.surface === 'roadway' ) roadway.add( cover.polygon, cover.polygon );
			if ( cover.surface === 'open' ) {
				plazas.add( cover.polygon, cover.polygon );
				if ( walkedOn( walked, cover.polygon ) ) plazaRings.push( cover.polygon );
			}
			yield;
		}
		const seats = new StreetLampSeats( this.atlas, plazaRings );
		for ( const edge of this.atlas.streets.edges ) {
			if ( edge.class === 'alley' ) alleys.add( edge, edge.path, edge.width / 2 + Math.max( edge.sidewalk?.left ?? 0, edge.sidewalk?.right ?? 0 ) );
			yield;
		}
		for ( const parcel of this.atlas.parcels ) { this.facades.add( parcel, parcel.footprint ); yield; }
		const road = { covers: ( x, z ) => roadway.near( x, z ).some( ring => pointInRing( x, z, ring ) ) };
		const occupied = new StreetFixtureIndex( MIN_GAP );
		// Seats a post at the first free spot the search finds and returns its
		// glow, or null when none is free.
		const accept = source => {
			if ( alleys.near( source.x, source.z ).some( edge => onPavementOf( source, edge ) ) ) return null;
			const spot = offAsphalt( road, source, seats, clearance );
			if ( ! spot || occupied.near( spot.x, spot.z, MIN_GAP ).some( other => Math.hypot( other.x - spot.x, other.z - spot.z ) < MIN_GAP ) ) return null;
			const { post, glow } = streetLampDescriptor( spot );
			if ( ! clearance.allows( post.head ) ) return null;
			occupied.add( spot, [ [ spot.x, spot.z ] ] );
			this.records.push( { id: `lamp:${this.records.length}`, kind: 'post', ...spot, post, glow } );
			this.posts.push( post ); this.glows.push( glow );
			return glow;
		};
		for ( const median of this.atlas.streets.construction?.medians ?? [] ) {
			const edge = this.atlas.streets.edges.find( value => value.id === median.edgeId );
			const a = edge.path[ 0 ], b = edge.path.at( - 1 ), length = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
			for ( const point of median.ornaments ) if ( point.kind === 'pole' ) {
				accept( { x: point.position[ 0 ], z: point.position[ 1 ], ax: -( b[ 1 ] - a[ 1 ] ) / length, az: ( b[ 0 ] - a[ 0 ] ) / length } );
				yield;
			}
		}
		for ( const spot of this.#alongStreets() ) {
			if ( ! plazas.near( spot.x, spot.z ).some( ring => pointInRing( spot.x, spot.z, ring ) ) ) accept( spot );
			yield;
		}
		for ( const spot of this.#atCrossings() ) {
			if ( ! plazas.near( spot.x, spot.z ).some( ring => pointInRing( spot.x, spot.z, ring ) ) ) accept( spot );
			yield;
		}
		for ( const spot of this.#aroundPlazas( plazaRings ) ) { accept( spot ); yield; }
		yield* this.#cover( this.glows, accept );
		this.facades = null;
		this.atlas = null; this.walk = null;

	}

	#wallPack( glows, wall ) {

		const glow = wallPackDescriptor( wall );
		this.records.push( { id: `lamp:${this.records.length}`, kind: 'wall', x: wall.px, z: wall.pz, ax: wall.nx, az: wall.nz, glow } );
		glows.push( glow );
		return glow;

	}

	/** One post every SPACING metres, alternating kerbs down each ground edge. */
	*#alongStreets() {

		for ( const edge of this.atlas.streets.edges ) {

			// A highway is carried on its own deck and has no sidewalks: posts
			// along it would stand at ground level under its edge, lining the
			// court beneath it as if a street ran there.
			if ( raised( edge ) ) continue;

			const points = samplePath( edge.path, SPACING );

			for ( const [ i, { point, normal } ] of points.entries() ) {

				const side = i % 2 ? - 1 : 1;
				// samplePath's normal points right of the directed route.
				const section = edge.crossSection?.sidewalks[ side > 0 ? 'right' : 'left' ];
				const bands = section?.bands;
				if ( bands && bands.furnishing < POLE_COLLIDER_RADIUS * 2 ) continue;
				const offset = edge.width / 2 + ( bands
					? ( section.geometry?.edge.gutter.width ?? 0 ) + bands.curb + bands.border + bands.furnishing / 2
					: Math.max( 1.1, ( edge.sidewalk?.left ?? 2.5 ) * 0.45 ) );

				yield {
					x: point.x + normal.x * offset * side,
					z: point.z + normal.z * offset * side,
					ax: - normal.x * side,
					az: - normal.z * side
				};

			}

		}

	}

	/** One post on the widest corner of every ground junction of three or more streets. */
	*#atCrossings() {
		const paths = new Map( this.atlas.streets.edges.map( ( edge ) => [ edge.id, edge ] ) );

		for ( const node of this.atlas.streets.nodes ) {

			const edges = [ ...new Set( groundEdgeIds( node, paths ) ) ].map( ( id ) => paths.get( id ) ).filter( Boolean );

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

			yield { x: nx + dx * reach, z: nz + dz * reach, ax: - dx, az: - dz };

		}

	}

	/** Walked plazas get a ring of posts just inside the edge and nothing in the middle. */
	*#aroundPlazas( plazas ) {

		for ( const ring of plazas ) {

			for ( const { point, normal } of samplePath( [ ...ring, ring[ 0 ] ], PLAZA_SPACING ) ) {

				// The ring is the plaza's border with whatever stands beside it:
				// the post stands on the plaza's own paving, its arm to the middle.
				const inward = pointInRing( point.x + normal.x * PLAZA_INSET, point.z + normal.z * PLAZA_INSET, ring ) ? 1 : - 1;
				yield {
					x: point.x + normal.x * PLAZA_INSET * inward, z: point.z + normal.z * PLAZA_INSET * inward,
					ax: normal.x * inward, az: normal.z * inward
				};

			}

		}

	}

	/**
	 * The coverage rule: no walkable segment is left with nothing on it, not
	 * even the dim edge of a lamp. Every segment the city publishes is measured
	 * against what the posts actually reach, and each stretch none of them
	 * reaches takes a wall pack on the facade beside it, or a post on the
	 * street land beside it where no facade is in reach.
	 */
	*#cover( glows, plant ) {

		if ( ! this.walk ) return;

		const reach = new Reach( LAMP_REACH );

		for ( const glow of glows ) { reach.add( glow.position.x, glow.position.z, glow.range ); yield; }

		for ( const edge of this.walk.edges ) {

			// A `link` walk edge is a bridge or a tunnel: it runs inside a
			// structure of its own, over the street or under it, and no fixture
			// on a facade at 4 m is lighting either of them.
			if ( edge.kind === 'link' ) continue;

			for ( let i = 0; i < edge.path.length - 1; i ++ ) {

				this.#coverLeg( glows, reach, edge.path[ i ], edge.path[ i + 1 ], edge.width ?? 1.2, plant );
				yield;

			}

		}

	}

	/**
	 * One straight leg of a walkable segment, lit end to end. The stretches no
	 * fixture reaches are exact intervals along the leg, and the darkest end of
	 * the first one takes a pack, until nothing is left uncovered. Where no
	 * facade is in reach (a walk past open land, or along the court under a
	 * highway, where no street edge plants posts) the stretch takes a post
	 * seated on street land beside it instead, and stays dark only where no
	 * seat is free, rather than growing a fixture in mid-air.
	 */
	#coverLeg( glows, reach, [ ax, az ], [ bx, bz ], width, plant ) {

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
			const x = ax + ux * at, z = az + uz * at;
			const wall = this.#facadeFacing( x, z );
			const fixture = wall ? this.#wallPack( glows, wall ) : postBeside( plant, x, z, ux, uz, width );

			if ( ! fixture ) return;

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

		for ( const parcel of this.facades.near( x, z, MOUNT_REACH ) ) {

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

}

/** How far a spot on the asphalt is walked back toward its kerb before it is given up. */
const KERB_SEARCH = 4;
const KERB_STEP = 0.5;
/**
 * How far a spot whose pavement is taken slides along its street, either way,
 * for a free seat: past a corner's crossing landing and its crosswalk, which
 * end some 16 m from a junction's centre where the first post is due at 9.5 m.
 */
const SLIDE_SEARCH = 8;
const SLIDE_STEP = 1;

/**
 * The spot itself when it seats clear of the asphalt, else the first point
 * behind it (away from the road its arm faces) that does, else the first one
 * nearer the kerb, else the same search a metre at a time along the street
 * either way, else null. Every candidate seats its whole base on street land,
 * so a spot whose pavement is taken (a crossing's landing and its crosswalk at
 * a corner) moves along the pavement rather than into a lot, and one with no
 * free pavement within reach is left to the facades.
 */
function offAsphalt( roadway, spot, seats, clearance ) {

	const at = ( back, slide ) => {

		const x = spot.x - spot.ax * back - spot.az * slide;
		const z = spot.z - spot.az * back + spot.ax * slide;
		if ( roadway.covers( x, z ) || ! seats.allows( x, z, POLE_COLLIDER_RADIUS ) || ! clearance.allowsBase( x, z, POLE_COLLIDER_RADIUS ) ) return null;
		return back || slide ? { ...spot, x, z } : spot;

	};
	for ( let step = 0; step <= 2 * SLIDE_SEARCH / SLIDE_STEP; step ++ ) {

		const slide = Math.ceil( step / 2 ) * SLIDE_STEP * ( step % 2 ? 1 : - 1 );
		for ( let back = 0; back <= KERB_SEARCH; back += KERB_STEP ) {

			const found = at( back, slide );
			if ( found ) return found;

		}
		for ( let ahead = KERB_STEP / 2; ahead <= KERB_SEARCH / 2; ahead += KERB_STEP / 2 ) {

			const found = at( - ahead, slide );
			if ( found ) return found;

		}

	}

	return null;

}

/**
 * A post beside a dark spot on a walk route, its arm over the route: tried
 * just clear of the walking ribbon on the right of the route, then the left,
 * each through the same seat search as a street's posts.
 */
function postBeside( plant, x, z, ux, uz, width ) {

	const off = width / 2 + POLE_COLLIDER_RADIUS + KERB_STEP;
	for ( const side of [ 1, - 1 ] ) {

		const nx = uz * side, nz = - ux * side;
		const glow = plant( { x: x + nx * off, z: z + nz * off, ax: - nx, az: - nz } );
		if ( glow ) return glow;

	}
	return null;

}

/** An edge carried above the ground: a highway on its deck. */
function raised( edge ) {

	return edge.class === 'highway' || ( edge.level ?? 0 ) > 0;

}

/**
 * The edges that meet at a node on the ground. Atlas groups a node's edges by
 * the level they meet at, so a highway passing over a street's node is no arm
 * of that crossing; without the grouping, raised edges are left out.
 */
function groundEdgeIds( node, paths ) {

	const ground = node.connections?.find( ( connection ) => connection.level === 0 );
	if ( ground ) return ground.edgeIds;
	if ( node.connections?.length ) return [];
	return node.edgeIds.filter( ( id ) => paths.has( id ) && ! raised( paths.get( id ) ) );

}

/**
 * Whether a walk route other than a bridge or a tunnel runs on an open ring at
 * grade, inside it or along its edge, for more than WALKED_ON metres: a
 * route that only ends at its border (a sidewalk stopping at the city's
 * fringe) touches it, and a platform or a passage below ground walks under it.
 */
function walkedOn( walked, ring ) {

	let minX = Infinity, minZ = Infinity, maxX = - Infinity, maxZ = - Infinity;
	for ( const [ x, z ] of ring ) { minX = Math.min( minX, x ); maxX = Math.max( maxX, x ); minZ = Math.min( minZ, z ); maxZ = Math.max( maxZ, z ); }
	for ( const edge of walked.query( { minX, minZ, maxX, maxZ } ) ) {

		const path = edge.path3 ?? edge.path.map( ( [ x, z ] ) => [ x, edge.level ?? 0, z ] );
		let on = 0;
		for ( let i = 0; i < path.length - 1; i ++ ) {

			const [ ax, ay, az ] = path[ i ], [ bx, by, bz ] = path[ i + 1 ];
			if ( Math.min( ay, by ) > GRADE_ABOVE || Math.max( ay, by ) < GRADE_BELOW ) continue;
			const steps = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) ) );
			for ( let k = 0; k <= steps; k ++ ) {

				const x = ax + ( bx - ax ) * k / steps, z = az + ( bz - az ) * k / steps;
				if ( ( pointInRing( x, z, ring ) || toRing( x, z, ring ) < 0.05 ) && ++ on > WALKED_ON ) return true;

			}

		}

	}
	return false;

}

function toRing( x, z, ring ) {

	let best = Infinity;
	for ( let i = 0; i < ring.length; i ++ ) {

		const [ ax, az ] = ring[ i ], [ bx, bz ] = ring[ ( i + 1 ) % ring.length ];
		const dx = bx - ax, dz = bz - az;
		const t = Math.max( 0, Math.min( 1, ( ( x - ax ) * dx + ( z - az ) * dz ) / ( dx * dx + dz * dz || 1 ) ) );
		best = Math.min( best, Math.hypot( x - ax - dx * t, z - az - dz * t ) );

	}
	return best;

}

/** Points every `step` metres along a polyline, with the right-hand normal. */
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
