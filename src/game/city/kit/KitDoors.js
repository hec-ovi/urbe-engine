import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { positionsOnly } from '../BuildingsLoader.js';
import { DoorMotion } from '../DoorMotion.js';
import { placementError } from './KitPieces.js';

/** What a fitted entrance casing projects past its wall plane. */
const SURFACE_DEPTH = 0.08;
/** How far outside and inside the doorway the interaction stands. */
const OUTSIDE = 1.4;
const INSIDE = 1.8;

/**
 * The one entrance of a kit building, in the shape the game already knows.
 *
 * A closed building draws its leaves with the rest of the entrance bay and
 * never opens them. A building with an interior behind it gets the leaves as
 * its own pivots instead, rebased on their hinges and posed with the piece, so
 * the interaction, the swing and the moving collider are the same code that
 * runs for an original shell.
 *
 * @param placement KitPlacement
 * @param pieces KitPieces, for the entrance bay's addressable leaves
 * @returns a door frame with pivots, or null when the building has no entrance
 */
export function kitDoor( placement, pieces ) {

	const record = placement.door;
	if ( ! record ) return null;

	const host = placement.placements[ record.placement ];
	const rotationY = placement.rotationY + ( host?.rotationY ?? 0 );
	const matrix = placement.matrixOf( host ?? { position: [ 0, 0, 0 ], rotationY: 0 } );
	const sill = record.position.clone().setY( placement.base + record.local.y );
	const door = {
		id: record.id,
		parcelId: placement.parcelId,
		floor: 0,
		kind: 'door',
		role: 'main',
		motion: new DoorMotion(),
		hinge: sill.clone().addScaledVector( record.along, - record.width / 2 ),
		along: record.along.clone(),
		normal: record.facing.clone(),
		width: record.width,
		height: record.height,
		surfaceDepth: SURFACE_DEPTH,
		center: sill.clone(),
		outside: sill.clone().addScaledVector( record.facing, OUTSIDE ),
		inside: sill.clone().addScaledVector( record.facing, - INSIDE ),
		open: 0,
		wanted: 0,
		pivots: []
	};

	for ( const leaf of pieces.leaves( record.piece ) ) door.pivots.push( pivotFor( door, leaf, matrix, rotationY ) );

	if ( door.pivots.length !== record.leaves ) {

		throw placementError( `${placement.parcelId}: ${record.piece} has ${door.pivots.length} leaves, the table publishes ${record.leaves}` );

	}
	door.motion.validateLeaves( door.pivots );

	return door;

}

/** One leaf, posed on its own hinge in the world. */
function pivotFor( door, leaf, matrix, rotationY ) {

	const pivot = new THREE.Group();
	pivot.name = `door:${door.parcelId}:${door.id}:${leaf.index}`;
	pivot.position.copy( leaf.origin ).applyMatrix4( matrix );
	pivot.quaternion.setFromAxisAngle( UP, rotationY );

	const bounds = new THREE.Box3();
	const parts = [];

	for ( const { geometry, material } of leaf.surfaces ) {

		const local = geometry.clone().translate( - leaf.origin.x, - leaf.origin.y, - leaf.origin.z );
		local.computeBoundingBox();
		bounds.union( local.boundingBox );
		parts.push( positionsOnly( local ) );
		pivot.add( new THREE.Mesh( local, material ) );

	}

	const swing = bounds.getCenter( _centre ).applyQuaternion( pivot.quaternion ).dot( door.along ) >= 0 ? 1 : - 1;
	const collider = parts.length === 1 ? parts[ 0 ] : BufferGeometryUtils.mergeGeometries( parts, false );
	if ( parts.length > 1 ) for ( const part of parts ) part.dispose();
	const entry = { pivot, index: leaf.index, sign: swing, colliderGeometry: collider };
	door.motion.prepare( entry, door.along );

	return entry;

}

const UP = new THREE.Vector3( 0, 1, 0 );
const _centre = new THREE.Vector3();
