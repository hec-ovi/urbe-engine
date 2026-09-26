import * as THREE from 'three/webgpu';

/** A skinned model named `name`, with the glTF body's eyebrows beside it when `eyebrows`. */
export function rig( name = 'body', { eyebrows = false } = {} ) {

	const root = new THREE.Group();
	const bone = new THREE.Bone();
	bone.name = 'root';
	const head = new THREE.Bone();
	head.name = 'Head';
	bone.add( head );
	const skeleton = new THREE.Skeleton( [ bone, head ] );
	const skinned = ( meshName, vertices ) => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( Array( vertices * 3 ).fill( 0 ), 3 ) );
		geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( Array( vertices * 4 ).fill( 0 ), 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( Array( vertices ).fill( [ 1, 0, 0, 0 ] ).flat(), 4 ) );
		// The pack's surfaces carry relief and roughness maps besides colour.
		const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshStandardMaterial( {
			map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture()
		} ) );
		mesh.name = meshName;
		return mesh;

	};
	const mesh = skinned( name, 2 );
	mesh.add( bone );
	mesh.bind( skeleton );
	root.add( mesh );
	if ( eyebrows ) {

		const brows = skinned( 'Eyebrows', 1 );
		brows.bind( skeleton );
		root.add( brows );

	}

	return root;

}

/** The talk, sit and sprint clips a focused rig plays and a death a still lies in, on the test rig's skeleton. */
export function animation() {

	const scene = rig();
	const times = [ 0, 1 ];
	const values = [ 0, 0, 0, 1, 0, 0, 0, 1 ];

	return {
		scene,
		animations: [
			new THREE.AnimationClip( 'Idle_Talking_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sitting_Talking_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Idle_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sprint_Enter', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			new THREE.AnimationClip( 'Sprint_Loop', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, values ) ] ),
			// Falls a quarter turn about +X over its second, as a body lies down.
			new THREE.AnimationClip( 'Death01', 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, [ 0, 0, 0, 1, Math.SQRT1_2, 0, 0, Math.SQRT1_2 ] ) ] )
		]
	};

}
