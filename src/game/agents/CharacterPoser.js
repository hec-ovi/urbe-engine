import * as THREE from 'three/webgpu';
import { ImageBitmapLoader, MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, vec2 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER_ROOT, assertRigCompatibility, avatarFor, bodyFor } from './CharacterCatalog.js';
import { look } from './Appearance.js';
import { dressedColorNode } from './BodyMesh.js';
import { CROWD_SURFACE } from './CrowdMesh.js';
import { hairColorNode } from './HairMesh.js';
import { garments } from './Garments.js';
import { CharacterAnimations } from './CharacterAnimations.js';

/** The maps' side when the tier names none. */
const TEXTURE_SIZE = 1024;
/** The final frame one step short of the clip's end, where a clamped action rests. */
const FINAL_OFFSET = 1 / 120;

/**
 * Full-quality Source people in the crowd's own look: the focused and fallen
 * rigs and the still bodies a staged scene lays out.
 *
 * A shape is read once for the run with its maps downscaled to the tier's
 * texture size, its hairstyle rigged to the head bone, and its Pro clips
 * transferred onto its bone lengths. A dressed root wears one set of the
 * model's dressed materials, sewn the first time a root needs it and worn
 * again by the next, so dressing a person builds no material that a previous
 * person already built.
 */
export class CharacterPoser {

	/** @param textureSize the side the pack's maps are downscaled to, the tier's texture size */
	constructor( { animation, textureSize = TEXTURE_SIZE, loadModel = ( descriptor ) => defaultLoad( descriptor, textureSize ) } ) {

		this.animation = animation;
		this.loadModel = loadModel;
		this.models = new Map();

	}

	/** One crowd shape, read and rigged once for the run. */
	model( descriptor ) {

		const key = modelKey( descriptor );

		if ( ! this.models.has( key ) ) {

			this.models.set( key, Promise.resolve( this.loadModel( descriptor ) ).then( ( model ) => {

				assertRigCompatibility( model.scene, this.animation.scene );
				model.motions = new CharacterAnimations( model.scene, this.animation.scene );
				model.wardrobe = [];
				// The glTF's eyebrows and every hairstyle wear the person's hair tint.
				model.scene.traverse( ( node ) => { if ( node.isSkinnedMesh && node.name.toLowerCase() === 'eyebrows' ) node.userData.hair = true; } );
				for ( const hair of modelHairs( model ) ) {

					assertRigCompatibility( hair.scene, this.animation.scene );
					attachHair( model.scene, hair.scene ).userData.hair = true;

				}
				return model;

			} ) );

		}

		return this.models.get( key );

	}

	/** A copy of the shape standing where the person does, dressed in their look. */
	dress( source, person, name ) {

		const root = clone( source.scene );
		dress( root, source, person.look );
		root.name = name;
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		root.traverse( ( node ) => {

			if ( ! node.isMesh ) return;
			node.castShadow = true;
			node.receiveShadow = true;

		} );
		return root;

	}

	/** Writes a look into the dressed set a root wears. */
	wear( root, personLook ) {

		const dressed = root.userData.dressed;
		if ( dressed && personLook ) wear( dressed, personLook );

	}

	/** Hands the root's dressed set back to its model's wardrobe. */
	release( root ) {

		if ( root.userData.dressed ) root.userData.dressed.worn = false;
		root.userData.dressed = null;

	}

	/**
	 * One person of the crowd held still in a pose: the body, hairstyle and look
	 * their gender and seed give on the street, posed by the transferred clip.
	 * The root stands at the origin facing +Z.
	 *
	 * @param at how far into the clip the pose is held, 0 its first frame and 1 its final one
	 */
	async still( { gender, appearanceSeed }, clipName, at ) {

		const clip = THREE.AnimationClip.findByName( this.animation.animations, clipName );
		if ( ! clip ) throw new Error( `Pro animation library is missing ${clipName}` );
		const descriptor = avatarFor( bodyFor( gender, appearanceSeed ) );
		const source = await this.model( descriptor );
		const root = this.dress( source, { position: new THREE.Vector3(), heading: 0, look: look( appearanceSeed ) }, `still-${descriptor.id}` );
		const mixer = new THREE.AnimationMixer( root );
		const action = mixer.clipAction( source.motions.clip( clip ) );
		action.setLoop( THREE.LoopOnce, 1 );
		action.clampWhenFinished = true;
		action.play();
		mixer.setTime( at * Math.max( 0, clip.duration - FINAL_OFFSET ) );
		action.paused = true;
		root.updateMatrixWorld( true );
		return root;

	}

}

async function defaultLoad( descriptor, textureSize ) {

	const loader = new GLTFLoader().register( ( parser ) => new ResizedTextures( parser, textureSize ) );
	const [ model, ...hairs ] = await Promise.all( [
		loader.loadAsync( `${CHARACTER_ROOT}/${descriptor.file}` ),
		...descriptor.hairs.map( ( file ) => loader.loadAsync( `${CHARACTER_ROOT}/${file}` ) )
	] );

	return { ...model, hairs };

}

/**
 * The pack's maps downscaled on the way in, the way the crowd's are: a 4K map
 * per channel is what kept a shape from staying resident.
 */
class ResizedTextures {

	constructor( parser, size ) {

		this.parser = parser;
		this.name = 'urbe_resized_textures';
		this.loader = new ImageBitmapLoader( parser.options.manager )
			.setOptions( { premultiplyAlpha: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } );
		this.loader.setCrossOrigin( parser.options.crossOrigin );

	}

	loadTexture( textureIndex ) {

		const { source } = this.parser.json.textures[ textureIndex ];

		return source === undefined ? null : this.parser.loadTextureImage( textureIndex, source, this.loader );

	}

}

export function modelKey( descriptor ) {

	return `${descriptor.id}:${descriptor.hairs.join( '+' )}`;

}

function modelHairs( model ) {

	return model.hairs ?? ( model.hair ? [ model.hair ] : [] );

}

/**
 * The pack's "Rigged to Head Bone" styles only follow Head. Baking the bind
 * pose into Head-local geometry makes that explicit and avoids a second
 * Skeleton update per person.
 */
function attachHair( bodyRoot, hairRoot ) {

	const body = skinnedMesh( bodyRoot );
	const hair = skinnedMesh( hairRoot );
	const head = body.skeleton.bones.find( ( bone ) => bone.name === 'Head' );

	if ( ! head ) throw new Error( 'character rig has no Head bone for its hairstyle' );

	bodyRoot.updateMatrixWorld( true );
	hairRoot.updateMatrixWorld( true );
	const intoHead = head.matrixWorld.clone().invert().multiply( hair.matrixWorld );
	const geometry = hair.geometry.clone().applyMatrix4( intoHead );
	const rigid = new THREE.Mesh( geometry, hair.material );
	rigid.name = hair.name;
	head.add( rigid );
	return rigid;

}

function skinnedMesh( root ) {

	let best = null;
	let vertices = - 1;

	root.traverse( ( node ) => {

		if ( ! node.isSkinnedMesh ) return;
		const count = node.geometry.getAttribute( 'position' )?.count ?? 0;
		if ( count > vertices ) { best = node; vertices = count; }

	} );

	if ( ! best ) throw new Error( 'character asset has no skinned mesh' );

	return best;

}

/**
 * Paints the bare base with the same outfit the baked slot wore, and tints its
 * hairstyle and eyebrows with the same hair colour, in dressed materials the
 * model keeps: a set is sewn the first time a root needs it and worn again by
 * the next, its look written into uniforms, so a person shown, fallen or laid
 * out never builds a material or drops one. Like the crowd's, these surfaces
 * carry no normal or roughness map: a painted shirt over the bare body's
 * relief would not be the shirt the street saw.
 */
function dress( root, model, personLook ) {

	if ( ! personLook ) return;
	const body = skinnedMesh( root );
	const source = Array.isArray( body.material ) ? body.material[ 0 ] : body.material;
	if ( ! source?.map ) return;

	if ( ! body.geometry.hasAttribute( 'cloth' ) ) body.geometry.setAttribute( 'cloth', garments( body ) );
	const dressed = model.wardrobe.find( ( entry ) => ! entry.worn ) ?? sew( model, body.geometry, source );
	dressed.worn = true;
	body.material = dressed.material;
	root.traverse( ( node ) => {

		if ( node.userData.hair && node.material?.map ) node.material = tinted( dressed, node.material );

	} );
	wear( dressed, personLook );
	root.userData.dressed = dressed;

}

/** Writes one person's look into a dressed set's uniforms. */
function wear( dressed, personLook ) {

	const { skin, shirt, trousers, hair, sleeve, hem } = dressed.look;
	skin.value.copy( personLook.skin );
	shirt.value.copy( personLook.shirt );
	trousers.value.copy( personLook.trousers );
	hair.value.copy( personLook.hair );
	sleeve.value = personLook.sleeve;
	hem.value = personLook.hem;

}

function sew( model, geometry, source ) {

	const uniforms = {
		skin: uniform( new THREE.Color() ), shirt: uniform( new THREE.Color() ), trousers: uniform( new THREE.Color() ),
		hair: uniform( new THREE.Color() ), sleeve: uniform( 0 ), hem: uniform( 0 )
	};
	const material = new MeshStandardNodeMaterial( CROWD_SURFACE );
	material.colorNode = dressedColorNode( geometry, source.map, {
		skin: uniforms.skin, shirt: uniforms.shirt, trousers: uniforms.trousers, cut: vec2( uniforms.sleeve, uniforms.hem )
	} );
	const dressed = { material, look: uniforms, hairs: new Map(), worn: false };
	model.wardrobe.push( dressed );

	return dressed;

}

/** The dressed set's tinted stand-in for one of the pack's hair materials, sewn once. */
function tinted( dressed, source ) {

	let material = dressed.hairs.get( source );
	if ( ! material ) {

		material = new MeshStandardNodeMaterial( CROWD_SURFACE );
		material.colorNode = hairColorNode( source.map, dressed.look.hair );
		dressed.hairs.set( source, material );

	}
	return material;

}
