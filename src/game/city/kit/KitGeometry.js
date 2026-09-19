import * as THREE from 'three/webgpu';
import { prepare } from './BatchGeometry.js';
import { placementError } from './KitPieces.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { bake } from '../GeometryBake.js';
import { bucketFor, splitBucket } from '../Variety.js';
import { doorFrames, doorLeafFrame } from '../DoorGeometry.js';
import { ScenicSurface } from '../ScenicSurface.js';
import { ShellBatches } from '../ShellBatches.js';
import { isSceneryNode, shellMaterial, shellScenery, shellVariant } from '../ShellSurface.js';

// A merged GLB names its surfaces `merged:<key>`; GLTFLoader strips the
// reserved characters, so the leading word is what survives to match on.
const EXTERIOR = 'merged';

/**
 * One plan's shell GLB read into what the city draws it with.
 *
 * `surfaces` are the whole building: every copy of this plan in the city draws
 * them from the same geometry, so they merge by material binding once here and
 * never again. `leaves` are the street entrance's addressable leaves, kept
 * apart because a parcel with a real interior swings its own pair while every
 * closed parcel draws them with the rest of the shell.
 *
 * All geometry is plan-local, the frame the plan was generated in: origin at
 * the entrance-face corner, face 0 along +X, walking surface at Y=0. A leaf also
 * carries its closed-pose origin, which is what a swinging copy is rebased on.
 *
 * @param blueprint the plan's own blueprint, which names its doors
 */
export function readShell( scene, factory, blueprint ) {

	scene.updateMatrixWorld( true );

	const scenic = new ScenicSurface( blueprint );
	const frames = doorFrames( blueprint );
	const main = frames.find( ( frame ) => frame.role === 'main' && frame.motion.supported ) ?? null;
	const shell = new Map();
	const leaves = new Map();

	scene.traverse( ( node ) => {

		if ( ! node.isMesh ) return;

		const key = node.material?.name ?? '';
		const bucket = bucketFor(
			key,
			shellVariant( factory, { key, authored: node.material?.userData?.materialVariant, blueprint } ),
			node.material?.side === THREE.DoubleSide
		);
		const leaf = doorLeafFrame( node, frames );

		if ( isSceneryNode( node ) ) {

			// A shared shell is drawn as a closed building, so the fake rooms
			// behind its glass stand with the room's own light baked in.
			const geometry = shellScenery( node, factory, { key, hasInterior: false, scenic } );
			if ( geometry ) push( shell, bucket, geometry );
			return;

		}

		if ( leaf && main && leaf.owner === main ) {

			if ( ! leaves.has( leaf.index ) ) {

				leaves.set( leaf.index, { index: leaf.index, origin: leaf.node.getWorldPosition( new THREE.Vector3() ), parts: new Map() } );

			}
			push( leaves.get( leaf.index ).parts, bucket, bake( node ) );
			return;

		}

		// Everything else the shell publishes: its facades, its slabs, its roof
		// and the leaves of every door this path does not move.
		if ( leaf || node.name?.startsWith( EXTERIOR ) ) push( shell, bucket, bake( node ) );

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

/**
 * One merged geometry and one factory material per material binding, with the
 * window scenery (the primitives carrying `scenicRadiance`) kept apart under
 * the scenery shader, exactly as the shell loader draws a generated building.
 */
function merged( buckets, factory ) {

	const batches = new ShellBatches();
	for ( const [ bucket, geometries ] of buckets ) batches.add( bucket, geometries );

	return [ ...batches.values() ].map( ( { key, scenic, geometries } ) => {

		const parts = geometries.length === 1 ? geometries : prepare( geometries );
		const geometry = parts.length === 1 ? parts[ 0 ] : BufferGeometryUtils.mergeGeometries( parts, false );
		if ( ! geometry ) throw placementError( `${key}: shell primitives do not merge` );
		if ( parts.length > 1 ) for ( const part of parts ) part.dispose();
		geometry.computeBoundingBox();
		const base = shellMaterial( factory, splitBucket( key ) );

		return { bucket: scenic ? `${key}|scenic` : key, geometry, material: scenic ? ScenicSurface.material( base ) : base };

	} );

}

function push( map, key, geometry ) {

	if ( ! map.has( key ) ) map.set( key, [] );
	map.get( key ).push( geometry );

}
