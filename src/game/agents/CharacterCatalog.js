const BASE = '/models';

export const CHARACTER_ROOT = `${BASE}/universal-base-characters-source`;
export const ANIMATION_URL = `${BASE}/universal-animation-library-pro/UAL1.glb`;
export const CHARACTER_MANIFEST_URL = `${BASE}/character-assets.json`;

/** Every full-body model in Universal Base Characters Source. */
export const CHARACTER_MODELS = [
	model( 'regular-male', 'male', 'Regular_Male', 'T_Regular_Male_Dark_BaseColor_png.png', 'Male/Hair_SimpleParted.gltf' ),
	model( 'regular-female', 'female', 'Regular_Female', 'T_Regular_Female_Dark_BaseColor_png.png', 'Female/Hair_Bob.gltf' ),
	model( 'teen-male', 'male', 'Teen_Male', 'T_Teen_Male_Dark_BaseColor.png', 'Male/Hair_SimpleParted_Teen.gltf' ),
	model( 'teen-female', 'female', 'Teen_Female', 'T_Teen_Female_Dark_BaseColor_png.png', 'Female/Hair_Bob_Teen.gltf' ),
	model( 'superhero-male', 'male', 'Superhero_Male', 'T_Superhero_Male_Dark.png', 'Male/Hair_SlickBack.gltf' ),
	model( 'superhero-female', 'female', 'Superhero_Female', 'T_Superhero_Female_Dark_BaseColor.png', 'Female/Hair_Buns.gltf' )
];

const HAIR_ROOT = 'Hairstyles/Rigged to Head Bone';
const MALE_HEAD = [
	'Hair_Balding', 'Hair_Buzzed', 'Hair_Dreads', 'Hair_Mohawk',
	'Hair_Ponytail', 'Hair_SimpleParted', 'Hair_SlickBack'
];
const MALE_FACE = [ 'Hair_Beard', 'Hair_Moustache', 'Hair_MuttonChops' ];
const FEMALE_HEAD = [
	'Hair_Bob', 'Hair_Buns', 'Hair_BuzzedFemale',
	'Hair_Long', 'Hair_LongDreads', 'Hair_Ponytail_2'
];

/** Every original Source hairstyle, separated where pieces may be combined. */
export const HAIRSTYLES = {
	male: {
		adult: paths( 'Male', MALE_HEAD ),
		teen: paths( 'Male', MALE_HEAD, true ),
		facial: paths( 'Male', MALE_FACE ),
		teenFacial: paths( 'Male', MALE_FACE, true )
	},
	female: {
		adult: paths( 'Female', FEMALE_HEAD ),
		teen: paths( 'Female', FEMALE_HEAD, true ),
		facial: [],
		teenFacial: []
	}
};

export const HAIRSTYLE_FILES = [ ...new Set(
	Object.values( HAIRSTYLES ).flatMap( ( set ) => Object.values( set ).flat() )
) ];

/** The two geometry-stable bodies used by the mass crowd. */
export const CROWD_MODELS = CHARACTER_MODELS.slice( 0, 2 );

export const CROWD_CLIP_NAMES = [
	'Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop', 'Sitting_Idle_Loop', 'Sitting_Talking_Loop',
	'Sprint_Loop', 'Crouch_Idle_Loop'
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
	const value = Number.isInteger( seed ) ? seed >>> 0 : 0;
	const shape = pool[ value % pool.length ];
	const teen = shape.id.startsWith( 'teen-' );
	const styles = HAIRSTYLES[ shape.gender ];
	const head = styles[ teen ? 'teen' : 'adult' ][ Math.floor( value / pool.length ) % styles.adult.length ];
	const facial = styles[ teen ? 'teenFacial' : 'facial' ];
	const faceIndex = Math.floor( value / ( pool.length * styles.adult.length ) ) % ( facial.length + 1 );

	return { ...shape, hairs: [ head, ...( faceIndex ? [ facial[ faceIndex - 1 ] ] : [] ) ] };

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

function paths( gender, names, teen = false ) {

	return names.map( ( name ) => `${HAIR_ROOT}/${gender}/${name}${teen ? '_Teen' : ''}.gltf` );

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
