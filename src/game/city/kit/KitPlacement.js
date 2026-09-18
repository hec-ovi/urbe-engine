import * as THREE from 'three/webgpu';
import { placementError } from './KitPieces.js';

const QUARTER = Math.PI / 2;

/**
 * One parcel's `<parcel>.placements.json`, read into the world.
 *
 * Kit assembly plans every building in world metres: piece positions, doors
 * and sign anchors are where they stand, and `lot` is the parcel's rectangle
 * as a world ring whose first edge is face 0. The lot frame here only serves
 * the colliders and openings, which are cut along the lot's edges.
 */
export class KitPlacement {

	constructor( parcelId, document, { bay = 8 } = {} ) {

		// Kit assembly wraps Exterior's own plan in the parcel's frame; a bare
		// plan reads the same way.
		const plan = document.plan ?? document;
		const frame = readFrame( document );

		this.parcelId = parcelId;
		this.family = document.family ?? plan.family;
		this.placements = plan.placements ?? [];
		this.rotationY = frame.rotationY;
		this.lot = readLot( document, bay );
		this.height = readHeight( document, plan );
		this.toWorld = new THREE.Matrix4()
			.makeTranslation( frame.origin.x, frame.origin.y, frame.origin.z )
			.multiply( new THREE.Matrix4().makeRotationY( frame.rotationY ) );
		this.base = frame.origin.y;
		this.center = this.point( this.lot.width / 2, 0, this.lot.depth / 2 );
		this.door = readDoor( plan, this );

		if ( ! this.placements.length ) throw placementError( `${parcelId} places no pieces` );
		if ( ! ( this.lot.width > 0 ) || ! ( this.lot.depth > 0 ) || ! ( this.height > 0 ) ) {

			throw placementError( `${parcelId} has no lot extent or envelope height` );

		}

	}

	/** The world matrix of one piece copy; the table already speaks world metres. */
	matrixOf( placement, target = new THREE.Matrix4() ) {

		return target.makeTranslation( placement.position[ 0 ], placement.position[ 1 ], placement.position[ 2 ] )
			.multiply( _rotation.makeRotationY( placement.rotationY ) );

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

const _rotation = new THREE.Matrix4();
const _toLot = new THREE.Matrix4();

/**
 * The lot frame from the world ring: origin at the first corner, X along the
 * first edge. A table without a ring (a bare plan) sits at the origin.
 */
function readFrame( document ) {

	const ring = Array.isArray( document.lot ) && document.lot.length === 4 ? document.lot : null;
	const base = document.bounds?.min?.[ 1 ] ?? 0;

	if ( ! ring ) return { origin: new THREE.Vector3( 0, base, 0 ), rotationY: 0 };

	const rotation = Math.atan2( - ( ring[ 1 ][ 1 ] - ring[ 0 ][ 1 ] ), ring[ 1 ][ 0 ] - ring[ 0 ][ 0 ] );

	return {
		origin: new THREE.Vector3( ring[ 0 ][ 0 ], base, ring[ 0 ][ 1 ] ),
		// A quarter turn is exact in the plan; keep it exact here too.
		rotationY: Math.abs( rotation / QUARTER - Math.round( rotation / QUARTER ) ) < 1e-9
			? Math.round( rotation / QUARTER ) * QUARTER
			: rotation
	};

}

/** Bay counts describe the lot exactly; published bounds answer for older tables. */
function readLot( document, bay ) {

	if ( Number.isInteger( document.baysAcross ) && Number.isInteger( document.baysDeep ) ) {

		return { width: document.baysAcross * bay, depth: document.baysDeep * bay };

	}
	const { min, max } = document.bounds ?? {};

	return { width: ( max?.[ 0 ] ?? 0 ) - ( min?.[ 0 ] ?? 0 ), depth: ( max?.[ 2 ] ?? 0 ) - ( min?.[ 2 ] ?? 0 ) };

}

/** Where the roof is: the top of the last band, or the published bounds. */
function readHeight( document, plan ) {

	const bands = plan.bands ?? [];
	if ( bands.length ) return Math.max( ...bands.map( ( band ) => band.base + band.height ) );

	return ( document.bounds?.max?.[ 1 ] ?? 0 ) - ( document.bounds?.min?.[ 1 ] ?? 0 );

}

/** The one entrance, in world metres, with the lot edge it sits in. */
function readDoor( document, placement ) {

	const record = document.doors?.[ 0 ];
	if ( ! record ) return null;

	const host = document.placements?.[ record.placement ];
	// The table speaks world metres; the lot-local point serves the wall cut.
	const position = new THREE.Vector3( ...record.position );
	const facing = new THREE.Vector3( ...record.facing ).setY( 0 ).normalize();

	return {
		id: record.id,
		width: record.width,
		height: record.height,
		leaves: record.leaves,
		local: position.clone().applyMatrix4( _toLot.copy( placement.toWorld ).invert() ),
		face: host?.face ?? 0,
		piece: host?.piece ?? null,
		placement: record.placement,
		position,
		facing,
		// Along the opening, left to right seen from outside: the axis the two
		// leaves hinge from and the axis a wall is split along.
		along: new THREE.Vector3( - facing.z, 0, facing.x )
	};

}
