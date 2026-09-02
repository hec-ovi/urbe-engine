import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, vec2 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { ANIMATION_URL, CHARACTER_ROOT, assertRigCompatibility, avatarFor } from './CharacterCatalog.js';
import { dressedColorNode } from './BodyMesh.js';
import { garments } from './Garments.js';

const TALK = 'Idle_Talking_Loop';
const SIT_TALK = 'Sitting_Talking_Loop';

/**
 * One full-quality skinned person while the player is talking to them. The
 * mass-crowd instance stays authoritative until this model is loaded and its
 * shaders are warm; then that one slot is hidden. There is never more than one
 * focused armature or AnimationMixer updating in the city.
 */
export class HeroCharacter {

	static async create( options = {} ) {

		const animation = options.animation ?? await new GLTFLoader().loadAsync( ANIMATION_URL );

		return new HeroCharacter( { ...options, animation } );

	}

	constructor( { animation, warmup = null, loadModel = defaultLoad } ) {

		this.animation = animation;
		this.warmup = warmup;
		this.loadModel = loadModel;
		this.models = new Map();
		this.group = new THREE.Group();
		this.group.name = 'focused-character';
		this.active = null;
		this.request = 0;

	}

	/** Loads and swaps one crowd member without ever exposing an unready mesh. */
	async show( person ) {

		const request = ++ this.request;
		const descriptor = avatarFor( person.gender, person.appearanceSeed ?? 0 );
		const source = await this.#model( descriptor );

		if ( request !== this.request ) return false;

		const root = clone( source.scene );
		dress( root, person.look );
		root.name = `focused-${descriptor.id}`;
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		root.visible = false;
		root.traverse( ( node ) => {

			if ( ! node.isMesh ) return;
			node.castShadow = true;
			node.receiveShadow = true;

		} );

		const clipName = person.clip === 3 || person.clip === 4 ? SIT_TALK : TALK;
		const clip = THREE.AnimationClip.findByName( this.animation.animations, clipName );

		if ( ! clip ) throw new Error( `Pro animation library is missing ${clipName}` );

		const mixer = new THREE.AnimationMixer( root );
		mixer.clipAction( withoutRootTravel( clip ) ).play();
		this.group.add( root );
		await this.warmup?.warm( root );

		if ( request !== this.request ) {

			this.group.remove( root );
			mixer.stopAllAction();
			return false;

		}

		this.#dropActive();
		person.hero = true;
		root.visible = true;
		this.active = { person, root, mixer, descriptor, key: `${descriptor.id}:${descriptor.hair}` };
		this.#keepOnly( this.active.key );

		return true;

	}

	update( delta ) {

		if ( ! this.active ) return;

		const { person, root, mixer } = this.active;
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		mixer.update( delta );

	}

	hide() {

		this.request ++;
		this.#dropActive();

	}

	#dropActive() {

		if ( ! this.active ) return;

		const { person, root, mixer } = this.active;
		person.hero = false;
		mixer.stopAllAction();
		this.group.remove( root );
		for ( const material of root.userData.transientMaterials ?? [] ) material.dispose();
		this.active = null;

	}

	async #model( descriptor ) {

		const key = `${descriptor.id}:${descriptor.hair}`;

		if ( ! this.models.has( key ) ) {

			this.models.set( key, Promise.resolve( this.loadModel( descriptor ) ).then( ( model ) => {

				assertRigCompatibility( model.scene, this.animation.scene );
				if ( model.hair ) {

					assertRigCompatibility( model.hair.scene, this.animation.scene );
					attachHair( model.scene, model.hair.scene );

				}
				return model;

			} ) );

		}

		return this.models.get( key );

	}

	/** Full Source maps are 4K, so an inactive shape cannot remain resident. */
	#keepOnly( key ) {

		for ( const [ cached, model ] of this.models ) {

			if ( cached === key ) continue;
			this.models.delete( cached );
			model.then( disposeModel );

		}

	}

}

async function defaultLoad( descriptor ) {

	const loader = new GLTFLoader();
	const [ model, hair ] = await Promise.all( [
		loader.loadAsync( `${CHARACTER_ROOT}/${descriptor.file}` ),
		loader.loadAsync( `${CHARACTER_ROOT}/${descriptor.hair}` )
	] );

	return { ...model, hair };

}

/**
 * The pack's "Rigged to Head Bone" styles only follow Head. Baking the bind
 * pose into Head-local geometry makes that explicit and avoids a second
 * Skeleton update on the focused character.
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

/** Paints the focused bare base with the same outfit the baked slot wore. */
function dress( root, look ) {

	if ( ! look ) return;
	const body = skinnedMesh( root );
	const source = Array.isArray( body.material ) ? body.material[ 0 ] : body.material;
	if ( ! source?.map ) return;

	body.geometry.setAttribute( 'cloth', garments( body ) );
	const material = new MeshStandardNodeMaterial( {
		roughness: source.roughness ?? 0.78,
		metalness: source.metalness ?? 0,
		normalMap: source.normalMap ?? null,
		roughnessMap: source.roughnessMap ?? null
	} );
	material.colorNode = dressedColorNode( body.geometry, source.map, {
		skin: uniform( look.skin ),
		shirt: uniform( look.shirt ),
		trousers: uniform( look.trousers ),
		cut: vec2( uniform( look.sleeve ), uniform( look.hem ) )
	} );
	body.material = material;
	root.userData.transientMaterials = [ material ];

}

function disposeModel( model ) {

	const geometries = new Set();
	const materials = new Set();
	const textures = new Set();

	for ( const root of [ model.scene, model.hair?.scene ] ) root?.traverse( ( node ) => {

		if ( node.geometry ) geometries.add( node.geometry );
		for ( const material of Array.isArray( node.material ) ? node.material : [ node.material ] ) {

			if ( ! material ) continue;
			materials.add( material );
			for ( const value of Object.values( material ) ) if ( value?.isTexture ) textures.add( value );

		}

	} );

	for ( const texture of textures ) texture.dispose();
	for ( const material of materials ) material.dispose();
	for ( const geometry of geometries ) geometry.dispose();

}

/** Locomotion belongs to the world position, so an animation cannot move it. */
function withoutRootTravel( clip ) {

	const copy = clip.clone();
	copy.tracks = copy.tracks.filter( ( track ) => track.name !== 'root.position' );

	return copy;

}
