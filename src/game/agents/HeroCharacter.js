import * as THREE from 'three/webgpu';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform, vec2 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import {
	ANIMATION_URL, CHARACTER_ROOT, CROWD_CLIP_NAMES,
	assertRigCompatibility, avatarFor
} from './CharacterCatalog.js';
import { dressedColorNode } from './BodyMesh.js';
import { garments } from './Garments.js';
import { FRAMES } from './VatBaker.js';
import { Ragdoll } from '../physics/Ragdoll.js';

const TALK = 'Idle_Talking_Loop';
const SIT_TALK = 'Sitting_Talking_Loop';
const BLEND_MS = 160;

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
		this.fallen = null;
		this.fallPending = false;
		this.request = 0;

	}

	/** Loads and swaps one crowd member without ever exposing an unready mesh. */
	async show( person, segments = null, onFinished = null ) {

		const request = ++ this.request;
		const sequence = this.#resolveSegments( segments ?? defaultSegments( person ) );
		if ( samePerson( this.active?.person, person ) ) {

			this.active.person = person;
			this.#play( sequence, onFinished );
			return true;

		}
		const descriptor = avatarFor( person.gender, person.appearanceSeed ?? 0 );
		const source = await this.#model( descriptor );

		if ( request !== this.request ) return false;

		const root = characterRoot( source, person, `focused-${descriptor.id}` );
		root.visible = false;

		const mixer = new THREE.AnimationMixer( root );
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
		this.active = {
			person, root, mixer, descriptor, key: modelKey( descriptor ),
			playback: null, sequence: 0, currentAction: null, currentClip: null
		};
		mixer.addEventListener( 'finished', ( event ) => this.#finished( mixer, event ) );
		this.#play( sequence, onFinished );
		this.#keepOnly( this.active.key, this.fallen?.key );

		return true;

	}

	/**
	 * Replaces one baked crowd slot with the same full Source body and lets the
	 * live Rapier ragdoll drive its bones. One fallen full body is resident at a
	 * time; a concurrent dialogue body remains independent.
	 */
	async fall( person, physics, impact ) {

		if ( this.fallen || this.fallPending ) return false;
		this.fallPending = true;
		const descriptor = avatarFor( person.gender, person.appearanceSeed ?? 0 );
		let root = null;
		let ragdoll = null;

		try {

			const source = await this.#model( descriptor );
			if ( this.fallen ) return false;
			root = characterRoot( source, person, `fallen-${descriptor.id}` );
			poseAtCrowdFrame( root, this.animation, person );
			if ( samePerson( this.active?.person, person ) ) this.#dropActive();
			ragdoll = Ragdoll.create( { physics, root, impact } );
			this.group.add( root );
			person.hero = true;
			this.fallen = { person, root, ragdoll, descriptor, key: modelKey( descriptor ) };
			this.#keepOnly( this.active?.key, this.fallen.key );
			return true;

		} catch ( error ) {

			ragdoll?.dispose();
			if ( root ) disposeCharacterRoot( root );
			throw error;

		} finally {

			this.fallPending = false;

		}

	}

	/** Plays one validated ordered transition on the active full-quality actor. */
	play( segments, onFinished = null ) {

		if ( ! this.active ) return false;
		this.#play( this.#resolveSegments( segments ), onFinished );
		return true;

	}

	update( delta ) {

		if ( this.fallen ) this.fallen.ragdoll.update( delta );
		if ( ! this.active ) return;

		const { person, root, mixer } = this.active;
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		mixer.update( delta );

	}

	/** Removes the dynamic body and returns its crowd slot to the caller. */
	clearFall() {

		if ( ! this.fallen ) return null;
		const fallen = this.fallen;
		this.fallen = null;
		fallen.ragdoll.dispose();
		fallen.person.hero = false;
		this.group.remove( fallen.root );
		disposeCharacterRoot( fallen.root );
		this.#keepOnly( this.active?.key );
		return fallen.person;

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
		disposeCharacterRoot( root );
		this.active = null;

	}

	#resolveSegments( segments ) {

		if ( ! Array.isArray( segments ) || segments.length === 0 ) throw new Error( 'focused animation needs at least one segment' );
		return segments.map( ( segment ) => {

			const clip = THREE.AnimationClip.findByName( this.animation.animations, segment.clipName );
			if ( ! clip ) throw new Error( `Pro animation library is missing ${segment.clipName}` );
			return {
				clipName: segment.clipName,
				loop: Boolean( segment.loop ),
				blendMs: segment.blendMs ?? BLEND_MS,
				clip: withoutRootTravel( clip )
			};

		} );

	}

	#play( segments, onFinished ) {

		const active = this.active;
		if ( ! active ) return;
		active.sequence ++;
		active.playback = { segments, index: 0, onFinished, sequence: active.sequence };
		this.#playCurrent();

	}

	#playCurrent() {

		const active = this.active;
		const playback = active?.playback;
		if ( ! active || ! playback ) return;
		const segment = playback.segments[ playback.index ];
		if ( ! segment ) return;
		const previous = active.currentAction;
		const action = active.mixer.clipAction( segment.clip );
		action.reset();
		action.enabled = true;
		action.clampWhenFinished = ! segment.loop;
		action.setLoop( segment.loop ? THREE.LoopRepeat : THREE.LoopOnce, segment.loop ? Infinity : 1 );
		action.play();
		if ( previous && previous !== action ) {

			action.crossFadeFrom( previous, Math.max( 0, segment.blendMs ) / 1000, true );

		}
		active.currentAction = action;
		active.currentClip = segment.clipName;

	}

	#finished( mixer, event ) {

		const active = this.active;
		const playback = active?.playback;
		if ( ! active || active.mixer !== mixer || ! playback || event.action !== active.currentAction ) return;
		if ( playback.index < playback.segments.length - 1 ) {

			playback.index ++;
			this.#playCurrent();
			return;

		}
		const finished = playback.onFinished;
		active.playback = null;
		if ( typeof finished === 'function' ) finished();

	}

	async #model( descriptor ) {

		const key = modelKey( descriptor );

		if ( ! this.models.has( key ) ) {

			this.models.set( key, Promise.resolve( this.loadModel( descriptor ) ).then( ( model ) => {

				assertRigCompatibility( model.scene, this.animation.scene );
				for ( const hair of modelHairs( model ) ) {

					assertRigCompatibility( hair.scene, this.animation.scene );
					attachHair( model.scene, hair.scene );

				}
				return model;

			} ) );

		}

		return this.models.get( key );

	}

	/** Full Source maps are 4K, so an inactive shape cannot remain resident. */
	#keepOnly( ...keys ) {

		const retained = new Set( keys.filter( Boolean ) );

		for ( const [ cached, model ] of this.models ) {

			if ( retained.has( cached ) ) continue;
			this.models.delete( cached );
			model.then( disposeModel );

		}

	}

}

function defaultSegments( person ) {

	return [ {
		clipName: person.clip === 3 || person.clip === 4 ? SIT_TALK : TALK,
		loop: true,
		blendMs: BLEND_MS
	} ];

}

function samePerson( left, right ) {

	if ( ! left || ! right ) return false;
	if ( left === right ) return true;
	return Boolean( left.npcId && right.npcId && left.npcId === right.npcId );

}

function characterRoot( source, person, name ) {

	const root = clone( source.scene );
	dress( root, person.look );
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

/** Reconstructs the baked person's authored frame before physics owns it. */
function poseAtCrowdFrame( root, animation, person ) {

	const name = CROWD_CLIP_NAMES[ person.clip ] ?? CROWD_CLIP_NAMES[ 1 ];
	const clip = THREE.AnimationClip.findByName( animation.animations, name );
	if ( ! clip ) throw new Error( `Pro animation library is missing ${name}` );
	const mixer = new THREE.AnimationMixer( root );
	const action = mixer.clipAction( withoutRootTravel( clip ) );
	action.play();
	mixer.setTime( ( ( person.frame ?? 0 ) % FRAMES / FRAMES ) * clip.duration );
	root.updateWorldMatrix( true, true );
	mixer.stopAllAction();

}

function disposeCharacterRoot( root ) {

	for ( const material of root.userData.transientMaterials ?? [] ) material.dispose();

}

async function defaultLoad( descriptor ) {

	const loader = new GLTFLoader();
	const [ model, ...hairs ] = await Promise.all( [
		loader.loadAsync( `${CHARACTER_ROOT}/${descriptor.file}` ),
		...descriptor.hairs.map( ( file ) => loader.loadAsync( `${CHARACTER_ROOT}/${file}` ) )
	] );

	return { ...model, hairs };

}

function modelKey( descriptor ) {

	return `${descriptor.id}:${descriptor.hairs.join( '+' )}`;

}

function modelHairs( model ) {

	return model.hairs ?? ( model.hair ? [ model.hair ] : [] );

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

	for ( const root of [ model.scene, ...modelHairs( model ).map( ( hair ) => hair.scene ) ] ) root?.traverse( ( node ) => {

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
