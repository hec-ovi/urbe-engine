import * as THREE from 'three/webgpu';

/** The bay every lot edge is a whole number of (../../../assembly/kit/CONTRACT.md). */
const BAY = 8;

/**
 * One building standing in the world: the plan it is a copy of, and the frame
 * it stands in.
 *
 * A city is a hundred or so distinct buildings placed hundreds of times, so kit
 * assembly generates each one once, at the origin with face 0 along +X, and
 * gives a parcel only `<parcel>.placements.json`: the plan's id, where its
 * origin stands and how far it is turned. That frame is the world matrix of the
 * copy, and the frame every opening of its blueprint is composed in.
 */
export class KitPlacement {

	/**
	 * @param record the parcel's `<parcel>.placements.json`
	 * @param plan the plan index entry it names
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

	}

	/**
	 * One lot edge in world metres: where its wall stands, how long it is and
	 * which way it faces. Face 0 runs +X from the lot origin, then +Z, -X, -Z.
	 */
	edge( face ) {

		const { width, depth } = this.lot;
		const corners = [ [ 0, 0 ], [ width, 0 ], [ width, depth ], [ 0, depth ] ];
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

}

/** A building the city cannot place, which fails the cell it stands in. */
export function placementError( message ) {

	return Object.assign( new Error( `E_KIT_PLACEMENT: ${message}` ), { code: 'E_KIT_PLACEMENT' } );

}
