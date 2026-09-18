import * as THREE from 'three/webgpu';
import { placementError } from './KitPieces.js';

/**
 * One building standing in the world: the plan it is made of, and the frame it
 * stands in.
 *
 * A city is a few dozen distinct buildings placed thousands of times, so kit
 * assembly writes each one's pieces once, at the origin with face 0 along +X,
 * and gives a parcel only `<parcel>.placements.json`: the plan's id, where its
 * origin stands and how far it is turned. The world matrix of a piece copy is
 * that frame times the plan's own placement.
 */
export class KitPlacement {

	/**
	 * @param record the parcel's `<parcel>.placements.json`
	 * @param plan the `kit/plans/<plan>.json` it names
	 */
	constructor( parcelId, record, plan, { bay = 8 } = {} ) {

		const origin = record.origin ?? [ 0, 0, 0 ];

		this.parcelId = parcelId;
		this.plan = plan.id;
		this.family = plan.family;
		// The plan names each piece file once; a copy carries its index.
		this.placements = ( plan.placements ?? [] ).map( ( copy ) => ( {
			piece: plan.pieces[ copy.piece ],
			face: copy.face,
			position: copy.position,
			rotationY: copy.rotationY
		} ) );
		this.rotationY = record.rotationY ?? 0;
		/** What this building's instance colour is hashed from. */
		this.tint = record.tint ?? parcelId;
		this.lot = { width: ( plan.baysAcross ?? 0 ) * bay, depth: ( plan.baysDeep ?? 0 ) * bay };
		this.height = Math.max( 0, ...( plan.bands ?? [] ).map( ( band ) => band.base + band.height ) );
		this.toWorld = new THREE.Matrix4()
			.makeTranslation( origin[ 0 ], origin[ 1 ], origin[ 2 ] )
			.multiply( new THREE.Matrix4().makeRotationY( this.rotationY ) );
		this.base = origin[ 1 ];
		this.center = this.point( this.lot.width / 2, 0, this.lot.depth / 2 );
		this.door = readDoor( plan, this );

		if ( ! this.placements.length ) throw placementError( `${parcelId} places no pieces` );
		if ( this.placements.some( ( copy ) => ! copy.piece ) ) throw placementError( `${parcelId} names a piece its plan does not list` );
		if ( ! ( this.lot.width > 0 ) || ! ( this.lot.depth > 0 ) || ! ( this.height > 0 ) ) {

			throw placementError( `${parcelId} has no lot extent or envelope height` );

		}

	}

	/** The world matrix of one piece copy: this building's frame times the plan's. */
	matrixOf( placement, target = new THREE.Matrix4() ) {

		target.makeRotationY( placement.rotationY );
		target.setPosition( placement.position[ 0 ], placement.position[ 1 ], placement.position[ 2 ] );

		return target.premultiply( this.toWorld );

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

/** The one entrance, with the lot edge it sits in. The plan speaks its own metres. */
function readDoor( plan, placement ) {

	const record = plan.doors?.[ 0 ];
	if ( ! record ) return null;

	const host = placement.placements[ record.placement ];
	const local = new THREE.Vector3( ...record.position );
	const facing = new THREE.Vector3( ...record.facing ).setY( 0 ).normalize().transformDirection( placement.toWorld );

	return {
		id: record.id,
		width: record.width,
		height: record.height,
		leaves: record.leaves,
		local,
		face: host?.face ?? 0,
		piece: host?.piece ?? null,
		placement: record.placement,
		position: local.clone().applyMatrix4( placement.toWorld ),
		facing,
		// Along the opening, left to right seen from outside: the axis the two
		// leaves hinge from and the axis a wall is split along.
		along: new THREE.Vector3( - facing.z, 0, facing.x )
	};

}
