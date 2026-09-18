import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { bake } from '../GeometryBake.js';
import { bucketFor, splitBucket } from '../Variety.js';
import { shellMaterial, shellVariant } from '../ShellSurface.js';

// The GLB names a leaf `door:<id>/leaf:<n>`; GLTFLoader strips the reserved
// characters, so what arrives is `door<id>leaf<n>`.
const LEAF = /^door(.+?)leaf(\d+)$/;

/**
 * One piece GLB read into what the city draws it with.
 *
 * `surfaces` are the shared parts: every copy of this piece in the city draws
 * them from the same geometry, so they merge by material binding once here and
 * never again. `leaves` are the addressable door leaves, kept apart because a
 * building with a real interior swings its own pair while every closed
 * building draws them with the rest of the piece.
 *
 * All geometry is piece-local, the frame kit.json publishes: run start or
 * corner junction on the walking surface, +X along the first run, +Z inward.
 * A leaf also carries its hinge, which is what a swinging copy is rebased on.
 */
export function readPiece( scene, factory ) {

	scene.updateMatrixWorld( true );

	const shell = new Map();
	const leaves = new Map();

	scene.traverse( ( node ) => {

		if ( ! node.isMesh ) return;

		const key = node.material?.name ?? '';
		const bucket = bucketFor(
			key,
			shellVariant( factory, { key, authored: node.material?.userData?.materialVariant } ),
			node.material?.side === THREE.DoubleSide
		);
		const leaf = LEAF.exec( node.name ?? '' );

		if ( ! leaf ) {

			push( shell, bucket, bake( node ) );
			return;

		}

		const index = Number( leaf[ 2 ] );
		if ( ! leaves.has( index ) ) {

			leaves.set( index, { index, origin: node.getWorldPosition( new THREE.Vector3() ), parts: new Map() } );

		}
		push( leaves.get( index ).parts, bucket, bake( node ) );

	} );

	return {
		surfaces: merged( shell, factory ),
		leaves: [ ...leaves.values() ].sort( ( a, b ) => a.index - b.index ).map( ( leaf ) => ( {
			index: leaf.index,
			origin: leaf.origin,
			surfaces: merged( leaf.parts, factory )
		} ) )
	};

}

/** One merged geometry and one factory material per material binding. */
function merged( buckets, factory ) {

	return [ ...buckets ].map( ( [ bucket, geometries ] ) => {

		const geometry = geometries.length === 1 ? geometries[ 0 ] : BufferGeometryUtils.mergeGeometries( geometries, false );
		if ( geometries.length > 1 ) for ( const part of geometries ) part.dispose();
		geometry.computeBoundingBox();

		return { bucket, geometry, material: shellMaterial( factory, splitBucket( bucket ) ) };

	} );

}

function push( map, key, geometry ) {

	if ( ! map.has( key ) ) map.set( key, [] );
	map.get( key ).push( geometry );

}
