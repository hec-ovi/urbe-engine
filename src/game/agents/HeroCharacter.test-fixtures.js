import * as THREE from 'three/webgpu';

const X = new THREE.Vector3( 1, 0, 0 );

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

/**
 * The crowd's clips, the talk, sit and sprint clips a focused rig plays and a
 * death a still lies in, on the test rig's skeleton; each a second long.
 * `turns` names clips, these or others, whose root turns about +X from one
 * angle (radians) at their first frame to another at their last, so a pose
 * tells which clip played and how far in: `{ Crouch_Enter: [ 0, 1 ] }`.
 */
export function animation( turns = {} ) {

	const scene = rig();
	const times = [ 0, 1 ];
	const clip = ( name, from = 0, to = 0 ) => new THREE.AnimationClip( name, 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, [
		...new THREE.Quaternion().setFromAxisAngle( X, from ).toArray(), ...new THREE.Quaternion().setFromAxisAngle( X, to ).toArray()
	] ) ] );
	const names = new Set( [
		'Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop',
		'Sprint_Loop', 'Crouch_Idle_Loop', 'Sprint_Enter', ...Object.keys( turns )
	] );

	return {
		scene,
		animations: [
			...[ ...names ].map( ( name ) => clip( name, ...( turns[ name ] ?? [] ) ) ),
			// Falls a quarter turn about +X over its second, as a body lies down.
			clip( 'Death01', 0, Math.PI / 2 )
		]
	};

}

/** How far the root of `root`, a dressed test rig, is turned about +X, in radians. */
export function rootTurn( root ) {

	const { x, w } = root.getObjectByName( 'root' ).quaternion;
	return 2 * Math.atan2( x, w );

}

/** A crowd person's look: every channel the rig is dressed in. */
export function outfit() {

	return {
		skin: new THREE.Color( 0xffffff ),
		shirt: new THREE.Color( 0x446688 ),
		trousers: new THREE.Color( 0x222833 ),
		hair: new THREE.Color( 0x2e1f16 ),
		sleeve: 0.55,
		hem: 0.88
	};

}
