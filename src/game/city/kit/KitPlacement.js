import * as THREE from 'three/webgpu';

/** The bay every lot edge is a whole number of (../../../assembly/kit/CONTRACT.md). */
const BAY = 8;
/** How high the ground band reads: what a person walks into rather than under. */
const GROUND = 2.2;
/** How finely that band is measured along a face, so a planter is not a wall. */
const COLUMN = 1;
/** A lip shallower than this is facade relief, not something a person walks into. */
const LIP = 0.25;
/** Neighbouring columns this close become one slab. */
const TOLERANCE = 0.25;

/**
 * One building standing in the world: the plan it is a copy of, and the frame
 * it stands in.
 *
 * A city is a hundred or so distinct buildings placed hundreds of times, so kit
 * assembly generates each one once, at the origin with face 0 along +X, and
 * gives a parcel only `<parcel>.placements.json`: the plan's id, where its
 * origin stands and how far it is turned. That frame is the world matrix of the
 * copy, and the frame every opening of its blueprint is composed in.
 *
 * The lot is the ground this building owns; the building itself stands inset
 * from it, by one to eight metres per side on almost every plan.
 * So the frame the colliders follow is `footprint`, the massing's own rectangle
 * in the lot frame, and the ground between that rectangle and the lot line is
 * paving the player walks.
 */
export class KitPlacement {

	/**
	 * @param record the parcel's `<parcel>.placements.json`
	 * @param plan the plan index entry it names, or the standing plan with its
	 *   geometry, which is what the ground band is measured from
	 */
	constructor( parcelId, record, plan ) {

		const origin = record.origin ?? [ 0, 0, 0 ];

		this.parcelId = parcelId;
		this.plan = plan?.id ?? record.plan;
		this.family = record.family ?? null;
		this.rotationY = record.rotationY ?? 0;
		/** What this building's instance colour is hashed from. */
		this.tint = record.tint ?? parcelId;
		this.lot = { width: ( plan?.baysAcross ?? 0 ) * BAY, depth: ( plan?.baysDeep ?? 0 ) * BAY };
		this.height = ( record.bounds?.max?.[ 1 ] ?? 0 ) - origin[ 1 ];
		this.toWorld = new THREE.Matrix4()
			.makeTranslation( origin[ 0 ], origin[ 1 ], origin[ 2 ] )
			.multiply( new THREE.Matrix4().makeRotationY( this.rotationY ) );
		this.base = origin[ 1 ];
		this.center = this.point( this.lot.width / 2, 0, this.lot.depth / 2 );

		if ( ! ( this.lot.width > 0 ) || ! ( this.lot.depth > 0 ) || ! ( this.height > 0 ) ) {

			throw placementError( `${parcelId} has no lot extent or envelope height` );

		}

		/** The massing's rectangle in the lot frame: where the building stands. */
		this.footprint = footprintOf( record, this.lot, this.toWorld );
		/** Per face, where the plan's ground-level geometry stands proud of it. */
		this.bands = groundBands( plan, this.footprint );

	}

	/**
	 * One footprint edge in world metres: where its wall stands, how long it is
	 * and which way it faces. Face 0 runs +X from the footprint's near corner,
	 * then +Z, -X, -Z, the same order the lot is walked in.
	 */
	edge( face ) {

		const { u0, v0, u1, v1 } = this.footprint;
		const corners = [ [ u0, v0 ], [ u1, v0 ], [ u1, v1 ], [ u0, v1 ] ];
		const start = corners[ face % 4 ];
		const end = corners[ ( face + 1 ) % 4 ];
		const length = Math.hypot( end[ 0 ] - start[ 0 ], end[ 1 ] - start[ 1 ] );
		const direction = [ ( end[ 0 ] - start[ 0 ] ) / length, ( end[ 1 ] - start[ 1 ] ) / length ];

		return {
			face: face % 4,
			length,
			start,
			direction,
			// Inward is the run turned a quarter to its left in this frame.
			inward: [ - direction[ 1 ], direction[ 0 ] ],
			rotationY: Math.atan2( - direction[ 1 ], direction[ 0 ] ) + this.rotationY
		};

	}

	/** A point of the lot frame in world metres. */
	point( u, y, v, target = new THREE.Vector3() ) {

		return target.set( u, y, v ).applyMatrix4( this.toWorld );

	}

	/**
	 * A world rectangle in the lot frame. Buildings stand on quarter turns, so
	 * the four corners come back as a rectangle again; any other angle gives the
	 * rectangle that holds them, which is the safe way round for a hole.
	 */
	lotRect( { x0, z0, x1, z1 } ) {

		const toLot = _toLot.copy( this.toWorld ).invert();
		const us = [];
		const vs = [];

		for ( const x of [ x0, x1 ] ) for ( const z of [ z0, z1 ] ) {

			const point = _corner.set( x, 0, z ).applyMatrix4( toLot );
			us.push( point.x );
			vs.push( point.z );

		}

		return { u0: Math.min( ...us ), v0: Math.min( ...vs ), u1: Math.max( ...us ), v1: Math.max( ...vs ) };

	}

}

/** A building the city cannot place, which fails the cell it stands in. */
export function placementError( message ) {

	return Object.assign( new Error( `E_KIT_PLACEMENT: ${message}` ), { code: 'E_KIT_PLACEMENT' } );

}

/**
 * The massing's rectangle in the lot frame, from the world box the record
 * publishes for it, which is the box of the blueprint this parcel composes. A
 * record without one leaves the whole lot standing, which is what a building of
 * unknown extent has to be.
 */
function footprintOf( record, lot, toWorld ) {

	const { min, max } = record.bounds ?? {};
	const whole = { u0: 0, v0: 0, u1: lot.width, v1: lot.depth };

	if ( ! corner( min ) || ! corner( max ) ) return whole;

	const toLot = _toLot.copy( toWorld ).invert();
	const us = [];
	const vs = [];

	for ( const x of [ min[ 0 ], max[ 0 ] ] ) {

		for ( const z of [ min[ 2 ], max[ 2 ] ] ) {

			const point = _corner.set( x, 0, z ).applyMatrix4( toLot );
			us.push( point.x );
			vs.push( point.z );

		}

	}

	const rect = {
		u0: Math.max( 0, Math.min( ...us ) ), v0: Math.max( 0, Math.min( ...vs ) ),
		u1: Math.min( lot.width, Math.max( ...us ) ), v1: Math.min( lot.depth, Math.max( ...vs ) )
	};

	return rect.u1 - rect.u0 > 1e-3 && rect.v1 - rect.v0 > 1e-3 ? rect : whole;

}

/**
 * What the plan puts on the ground outside its own footprint: the plinths,
 * entrance steps and planter walls a few families stand on. They are part of
 * the shared geometry, so this is measured once per plan, off the surfaces the
 * city has already decoded, and every copy of that plan reads the answer.
 *
 * It is measured a metre at a time along each face, because a planter beside
 * the door is not a wall across the frontage: only the stretches that carry
 * something come back.
 *
 * @returns per face the runs `{ from, to, depth, height }`: where along the
 *   edge that geometry stands, how far it is proud of it, and how high it
 *   reaches above the walking surface
 */
function groundBands( plan, footprint ) {

	if ( ! plan?.surfaces?.length ) return flat();

	const known = _bands.get( plan );

	if ( known && same( known.footprint, footprint ) ) return known.faces;

	const faces = measureBands( plan, footprint );
	_bands.set( plan, { footprint, faces } );

	return faces;

}

function measureBands( plan, { u0, v0, u1, v1 } ) {

	const lengths = [ u1 - u0, v1 - v0, u1 - u0, v1 - v0 ];
	const columns = lengths.map( ( length ) => new Array( Math.max( 1, Math.ceil( length / COLUMN ) ) ).fill( null ) );

	// The shell's own surfaces: the fake rooms stand behind its glass and the
	// entrance leaves stand in its doorway, so neither can be proud of it.
	for ( const { geometry } of plan.surfaces ) {

		if ( ! geometry.boundingBox ) geometry.computeBoundingBox();

		const box = geometry.boundingBox;
		const inside = box.min.x >= u0 && box.max.x <= u1 && box.min.z >= v0 && box.max.z <= v1;

		if ( box.min.y > GROUND || inside ) continue;

		// Triangle by triangle rather than vertex by vertex, because a plinth is
		// a handful of large quads and its corners say nothing about the metres
		// of face between them.
		for ( const face of triangles( geometry ) ) {

			if ( face.minY > GROUND ) continue;

			const top = Math.min( GROUND, face.maxY );
			// How far this triangle stands outside each face of the footprint,
			// and the stretch of that face it stands along.
			const proud = [ v0 - face.minZ, face.maxX - u1, face.maxZ - v1, u0 - face.minX ];
			const from = [ face.minX - u0, face.minZ - v0, u1 - face.maxX, v1 - face.maxZ ];
			const to = [ face.maxX - u0, face.maxZ - v0, u1 - face.minX, v1 - face.minZ ];

			for ( let side = 0; side < 4; side ++ ) {

				if ( proud[ side ] <= LIP ) continue;

				fill( columns[ side ], from[ side ], to[ side ], proud[ side ], top );

			}

		}

	}

	return columns.map( ( row, side ) => runs( row, lengths[ side ] ) );

}

/** One triangle standing over a stretch of a face, as far out as it reaches. */
function fill( row, from, to, depth, top ) {

	// A triangle past either end of a face belongs to its end column, which is
	// the corner both faces meet at.
	const first = Math.min( row.length - 1, Math.max( 0, Math.floor( from / COLUMN ) ) );
	const last = Math.min( row.length - 1, Math.max( 0, Math.floor( to / COLUMN ) ) );

	for ( let index = first; index <= last; index ++ ) {

		const column = row[ index ] ?? ( row[ index ] = { depth: 0, height: 0 } );

		column.depth = Math.max( column.depth, depth );
		column.height = Math.max( column.height, top );

	}

}

/** A geometry's triangles as their own extents, indexed or not. */
function* triangles( geometry ) {

	const position = geometry.getAttribute( 'position' );
	const index = geometry.getIndex();
	const count = index ? index.count : position.count;

	for ( let start = 0; start + 2 < count; start += 3 ) {

		const extent = { minX: Infinity, maxX: - Infinity, minY: Infinity, maxY: - Infinity, minZ: Infinity, maxZ: - Infinity };

		for ( let which = 0; which < 3; which ++ ) {

			const vertex = index ? index.getX( start + which ) : start + which;
			const x = position.getX( vertex );
			const y = position.getY( vertex );
			const z = position.getZ( vertex );

			extent.minX = Math.min( extent.minX, x );
			extent.maxX = Math.max( extent.maxX, x );
			extent.minY = Math.min( extent.minY, y );
			extent.maxY = Math.max( extent.maxY, y );
			extent.minZ = Math.min( extent.minZ, z );
			extent.maxZ = Math.max( extent.maxZ, z );

		}

		yield extent;

	}

}

/** Columns standing next to each other, and near enough alike, as one slab. */
function runs( columns, length ) {

	const kept = [];

	for ( let index = 0; index < columns.length; index ++ ) {

		const column = columns[ index ];
		if ( ! column ) continue;

		const last = kept[ kept.length - 1 ];
		const from = index * COLUMN;
		const to = Math.min( length, from + COLUMN );

		if ( last && last.to === from && alike( last, column ) ) {

			last.to = to;
			last.depth = Math.max( last.depth, column.depth );
			last.height = Math.max( last.height, column.height );

		} else kept.push( { from, to, depth: column.depth, height: column.height } );

	}

	return kept;

}

function alike( run, column ) {

	return Math.abs( run.depth - column.depth ) <= TOLERANCE && Math.abs( run.height - column.height ) <= TOLERANCE;

}

/** Four faces standing on nothing but the footprint. */
function flat() {

	return [ [], [], [], [] ];

}

function corner( point ) {

	return Array.isArray( point ) && Number.isFinite( point[ 0 ] ) && Number.isFinite( point[ 2 ] );

}

function same( a, b ) {

	return Math.abs( a.u0 - b.u0 ) < 1e-6 && Math.abs( a.v0 - b.v0 ) < 1e-6
		&& Math.abs( a.u1 - b.u1 ) < 1e-6 && Math.abs( a.v1 - b.v1 ) < 1e-6;

}

/** plan -> the band it was measured as, so a hundred copies measure it once. */
const _bands = new WeakMap();
const _toLot = new THREE.Matrix4();
const _corner = new THREE.Vector3();
