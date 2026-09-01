import * as THREE from 'three/webgpu';

/** Arm and leg parameters of vertices that are not on that limb at all. */
const OFF_LIMB = 2;
/** Below this share of a vertex, a bone is a rounding error, not a limb. */
const LIMB_MIN = 0.05;

// Distance along each limb, by the bone that drives it. The universal skeleton
// names them the same on both sides and in every pack, so this table is the
// whole body plan.
const ARM = { clavicle: 0, upperarm: 0.28, lowerarm: 0.66, hand: 0.9, thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };
const LEG = { pelvis: 0, thigh: 0.32, calf: 0.7, foot: 0.92, ball: 1 };
const TORSO = 'spine';
const SHOE = [ 'foot', 'ball' ];

/**
 * Where the clothes go on a base body, read off the skeleton it is bound to
 * rather than guessed from its height: the bones driving a vertex say whether
 * it is chest, forearm or shin, on any body and in any pose.
 *
 * The answer is one vec4 per vertex, which the crowd shader reads directly:
 * - x: torso share, 1 on the chest and shoulders, fading out at the neck
 * - y: how far along the arm, 0 at the shoulder to 1 at the fingertips
 * - z: how far down the leg, 0 at the waist to 1 at the toes
 * - w: foot share, which is where a shoe is
 *
 * A vertex off a limb carries OFF_LIMB for it, so a sleeve or a hem is one
 * comparison against one number and misses everything it should.
 *
 * @param mesh the skinned base body, still carrying its skin attributes
 * @returns BufferAttribute, one vec4 per vertex
 */
export function garments( mesh ) {

	const index = mesh.geometry.getAttribute( 'skinIndex' );
	const weight = mesh.geometry.getAttribute( 'skinWeight' );

	if ( ! index || ! weight ) throw new Error( 'character body is not skinned' );

	const bones = mesh.skeleton.bones.map( ( bone ) => boneKind( bone.name ) );
	const data = new Float32Array( index.count * 4 );

	for ( let i = 0; i < index.count; i ++ ) {

		let torso = 0;
		let shoe = 0;
		let armShare = 0;
		let arm = 0;
		let legShare = 0;
		let leg = 0;

		for ( let slot = 0; slot < 4; slot ++ ) {

			const share = weight.getComponent( i, slot );

			if ( share <= 0 ) continue;

			const bone = bones[ index.getComponent( i, slot ) ];

			if ( bone === TORSO ) torso += share;
			if ( SHOE.includes( bone ) ) shoe += share;

			if ( bone in ARM ) {

				armShare += share;
				arm += share * ARM[ bone ];

			}

			if ( bone in LEG ) {

				legShare += share;
				leg += share * LEG[ bone ];

			}

		}

		data[ i * 4 ] = torso;
		data[ i * 4 + 1 ] = armShare >= LIMB_MIN ? arm / armShare : OFF_LIMB;
		data[ i * 4 + 2 ] = legShare >= LIMB_MIN ? leg / legShare : OFF_LIMB;
		data[ i * 4 + 3 ] = shoe;

	}

	return new THREE.BufferAttribute( data, 4 );

}

/**
 * The body part a bone belongs to: `lowerarm_l` and `index_04_leaf_r` are a
 * forearm and a finger wherever they are and whichever side they are on.
 */
function boneKind( name ) {

	return name.toLowerCase()
		.replace( /_(l|r)$/, '' )
		.replace( /_leaf$/, '' )
		.replace( /_\d+$/, '' );

}
