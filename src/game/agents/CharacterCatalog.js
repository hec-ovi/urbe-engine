const BASE = '/models';

export const CHARACTER_ROOT = `${BASE}/universal-base-characters-source`;
export const ANIMATION_URL = `${BASE}/universal-animation-library-pro/UAL1.glb`;

/** Every full-body model in Universal Base Characters Source. */
export const CHARACTER_MODELS = [
	model( 'regular-male', 'male', 'Regular_Male', 'T_Regular_Male_Dark_BaseColor_png.png', 'Male/Hair_SimpleParted.gltf' ),
	model( 'regular-female', 'female', 'Regular_Female', 'T_Regular_Female_Dark_BaseColor_png.png', 'Female/Hair_Bob.gltf' ),
	model( 'teen-male', 'male', 'Teen_Male', 'T_Teen_Male_Dark_BaseColor.png', 'Male/Hair_SimpleParted_Teen.gltf' ),
	model( 'teen-female', 'female', 'Teen_Female', 'T_Teen_Female_Dark_BaseColor_png.png', 'Female/Hair_Bob_Teen.gltf' ),
	model( 'superhero-male', 'male', 'Superhero_Male', 'T_Superhero_Male_Dark.png', 'Male/Hair_SlickBack.gltf' ),
	model( 'superhero-female', 'female', 'Superhero_Female', 'T_Superhero_Female_Dark_BaseColor.png', 'Female/Hair_Buns.gltf' )
];

/** The two geometry-stable bodies used by the mass crowd. */
export const CROWD_MODELS = CHARACTER_MODELS.slice( 0, 2 );

export const CROWD_CLIP_NAMES = [
	'Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop'
];

export const PLAYER_CLIP_NAMES = {
	IDLE: 'Idle_Loop',
	WALK: 'Walk_Loop',
	SPRINT: 'Sprint_Loop',
	CROUCH: 'Crouch_Idle_Loop',
	CROUCH_WALK: 'Crouch_Fwd_Loop',
	JUMP_START: 'Jump_Start',
	JUMP: 'Jump_Loop',
	JUMP_LAND: 'Jump_Land'
};

/** Crowd geometry follows gender and remains stable for that person's life. */
export function bodyFor( gender, seed ) {

	const index = CROWD_MODELS.findIndex( ( entry ) => entry.gender === gender );

	return index >= 0 ? index : seed % CROWD_MODELS.length;

}

/** A full-quality player or focused NPC gets a deterministic shape of its gender. */
export function avatarFor( gender, seed ) {

	const matching = CHARACTER_MODELS.filter( ( entry ) => ! gender || entry.gender === gender );
	const pool = matching.length ? matching : CHARACTER_MODELS;

	return pool[ seed % pool.length ];

}

export function assertRigCompatibility( characterRoot, animationRoot ) {

	const character = skeletonOf( characterRoot );
	const animation = skeletonOf( animationRoot );

	if ( character.join( '\n' ) !== animation.join( '\n' ) ) {

		throw new Error( 'character skeleton does not match the Universal Animation Library rig' );

	}

	return character;

}

function model( id, gender, stem, skin, hair ) {

	return {
		id, gender, file: `${stem}_FullBody.gltf`, skin,
		hair: `Hairstyles/Rigged to Head Bone/${hair}`
	};

}

function skeletonOf( root ) {

	let bones = null;

	root.traverse( ( node ) => {

		if ( node.isSkinnedMesh && ( ! bones || node.skeleton.bones.length > bones.length ) ) {

			bones = node.skeleton.bones.map( ( bone ) => bone.name );

		}

	} );

	if ( ! bones ) throw new Error( 'character asset has no skinned mesh' );

	return bones;

}
