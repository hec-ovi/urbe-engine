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
		const normal = new THREE.Vector3();
		const skin = new THREE.Matrix4();
		const boundSkin = new THREE.Matrix4();

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
						skinNormal( target.mesh, i, normal, skin, boundSkin );
						normal.toArray( target.normal, stride + i * 4 );

					}

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
 * Applies the renderer's linear-blend skin transform to one authored normal.
 * Keeping the source normal preserves its intentional smoothing and hard edges.
 */
function skinNormal( mesh, index, target, skin, boundSkin ) {

	const geometry = mesh.geometry;
	const source = geometry.getAttribute( 'normal' );
	const joints = geometry.getAttribute( 'skinIndex' );
	const weights = geometry.getAttribute( 'skinWeight' );
	const boneMatrices = mesh.skeleton.boneMatrices;
	const elements = skin.elements;
	elements.fill( 0 );

	for ( let slot = 0; slot < 4; slot ++ ) {

		const weight = weights.getComponent( index, slot );
		const offset = joints.getComponent( index, slot ) * 16;

		for ( let element = 0; element < 16; element ++ ) {

			elements[ element ] += boneMatrices[ offset + element ] * weight;

		}

	}

	boundSkin.multiplyMatrices( mesh.bindMatrixInverse, skin ).multiply( mesh.bindMatrix );
	target.fromBufferAttribute( source, index ).transformDirection( boundSkin );

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
