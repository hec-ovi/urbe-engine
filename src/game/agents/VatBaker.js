import * as THREE from 'three/webgpu';

export const FRAMES = 32;

/**
 * Bakes a skinned mesh's animation loops into vertex animation buffers: one
 * row per frame, one vec4 per vertex, positions in one buffer and normals in
 * the other. Every clip is baked to the same frame count, so a clip is just a
 * row offset.
 *
 * This is what lets the whole crowd render as a single instanced draw with no
 * skeletons and no per-character CPU work at all. Baking happens once at load
 * and costs a few tens of milliseconds.
 */
export class VatBaker {

	/**
	 * @param root the loaded character scene (holds the skeleton)
	 * @param meshes SkinnedMesh list to bake, all sharing that skeleton
	 * @param clips AnimationClip list, baked in order
	 */
	static bake( root, meshes, clips ) {

		const mixer = new THREE.AnimationMixer( root );
		const actions = clips.map( ( clip ) => mixer.clipAction( stripRootMotion( clip ) ) );
		const rows = clips.length * FRAMES;

		const targets = meshes.map( ( mesh ) => {

			const count = mesh.geometry.getAttribute( 'position' ).count;

			return {
				mesh,
				count,
				position: new Float32Array( count * rows * 4 ),
				normal: new Float32Array( count * rows * 4 )
			};

		} );

		const vertex = new THREE.Vector3();

		for ( let c = 0; c < clips.length; c ++ ) {

			const action = actions[ c ];
			actions.forEach( ( a ) => a.stop() );
			action.reset().play();

			for ( let f = 0; f < FRAMES; f ++ ) {

				mixer.setTime( ( f / FRAMES ) * clips[ c ].duration );
				root.updateMatrixWorld( true );

				const row = c * FRAMES + f;

				for ( const target of targets ) {

					target.mesh.skeleton.update();
					const stride = row * target.count * 4;

					// getVertexPosition loads the rest position and then applies
					// the bone transform. applyBoneTransform alone reads its base
					// position out of the vector it is handed, so calling it with
					// a zero vector skins the origin, not the vertex.
					for ( let i = 0; i < target.count; i ++ ) {

						target.mesh.getVertexPosition( i, vertex );
						vertex.toArray( target.position, stride + i * 4 );

					}

					writeNormals( target, stride );

				}

			}

		}

		mixer.stopAllAction();

		return targets.map( ( target ) => ( {
			mesh: target.mesh,
			vertexCount: target.count,
			rows,
			position: target.position,
			normal: target.normal
		} ) );

	}

}

/**
 * Area-weighted vertex normals over the frame's deformed positions. Baking
 * these is cheaper and steadier than skinning the rest-pose normals.
 */
function writeNormals( target, stride ) {

	const { position, normal, count } = target;
	const index = target.mesh.geometry.index;
	const triangles = index ? index.count : count;

	for ( let i = 0; i < count; i ++ ) {

		normal[ stride + i * 4 ] = 0;
		normal[ stride + i * 4 + 1 ] = 0;
		normal[ stride + i * 4 + 2 ] = 0;

	}

	const ax = [ 0, 0, 0 ];
	const bx = [ 0, 0, 0 ];

	for ( let t = 0; t < triangles; t += 3 ) {

		const ia = index ? index.getX( t ) : t;
		const ib = index ? index.getX( t + 1 ) : t + 1;
		const ic = index ? index.getX( t + 2 ) : t + 2;
		const oa = stride + ia * 4;
		const ob = stride + ib * 4;
		const oc = stride + ic * 4;

		for ( let k = 0; k < 3; k ++ ) {

			ax[ k ] = position[ ob + k ] - position[ oa + k ];
			bx[ k ] = position[ oc + k ] - position[ oa + k ];

		}

		const nx = ax[ 1 ] * bx[ 2 ] - ax[ 2 ] * bx[ 1 ];
		const ny = ax[ 2 ] * bx[ 0 ] - ax[ 0 ] * bx[ 2 ];
		const nz = ax[ 0 ] * bx[ 1 ] - ax[ 1 ] * bx[ 0 ];

		for ( const offset of [ oa, ob, oc ] ) {

			normal[ offset ] += nx;
			normal[ offset + 1 ] += ny;
			normal[ offset + 2 ] += nz;

		}

	}

	for ( let i = 0; i < count; i ++ ) {

		const offset = stride + i * 4;
		const length = Math.hypot( normal[ offset ], normal[ offset + 1 ], normal[ offset + 2 ] ) || 1;
		normal[ offset ] /= length;
		normal[ offset + 1 ] /= length;
		normal[ offset + 2 ] /= length;

	}

}

/**
 * Locomotion is driven by the game, not the clip, so the root's own travel is
 * dropped and only its rotation and the rest of the skeleton are kept.
 */
function stripRootMotion( clip ) {

	const copy = clip.clone();
	copy.tracks = copy.tracks.filter( ( track ) => track.name !== 'root.position' );

	return copy;

}
