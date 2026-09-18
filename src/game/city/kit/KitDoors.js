import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { positionsOnly } from '../BuildingsLoader.js';
import { doorFrames } from '../DoorGeometry.js';

/**
 * The street entrance of a kit building, in the shape the game already knows.
 *
 * The frame itself is the one `DoorGeometry` builds from the blueprint, which
 * for a kit parcel is its plan's document composed into its own frame, so the
 * interaction, the swing and the moving collider read exactly what an original
 * shell's do. What differs is the leaves: they belong to the shared plan, so a
 * parcel with an interior behind the door poses its own copies on their hinges
 * and a closed parcel draws them with the rest of the shell.
 */

/** This building's street entrance, or null when it has none that can move. */
export function mainDoor( blueprint ) {

	return doorFrames( blueprint ).find( ( door ) => door.role === 'main' && door.motion.supported ) ?? null;

}

/**
 * Gives the entrance its own moving leaves, posed from the plan's.
 * @param pieces KitPieces, which holds each plan's addressable leaves
 * @returns whether the door can swing, which needs at least one leaf
 */
export function swingLeaves( door, placement, pieces ) {

	for ( const leaf of pieces.leaves( placement.plan ) ) {

		door.pivots.push( pivotFor( door, leaf, placement.toWorld, placement.rotationY ) );

	}
	if ( ! door.pivots.length ) return false;

	door.motion.validateLeaves( door.pivots );

	return true;

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
