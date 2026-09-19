import * as THREE from 'three/webgpu';
import { ImageBitmapLoader, MeshStandardNodeMaterial } from 'three/webgpu';
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
import { CharacterAnimations } from './CharacterAnimations.js';
import { streetBodies } from './StreetBodies.js';
import { Ragdoll } from '../physics/Ragdoll.js';

const TALK = 'Idle_Talking_Loop';
const SIT_TALK = 'Sitting_Talking_Loop';
const BLEND_MS = 160;
/** The maps' side when the tier names none. */
const TEXTURE_SIZE = 1024;
/** What a prepared shape wears while its programs are built. */
const PLAIN_LOOK = {
	skin: new THREE.Color( 1, 1, 1 ), shirt: new THREE.Color( 1, 1, 1 ), trousers: new THREE.Color( 1, 1, 1 ), sleeve: 0, hem: 0
};

/**
 * One full-quality skinned person while the player is talking to them. The
 * mass-crowd instance stays authoritative until this model is loaded and its
 * shaders are warm; then that one slot is hidden. There is never more than one
 * focused armature or AnimationMixer updating in the city.
 *
 * A shape read once stays for the run: its maps come in downscaled to the
 * tier's texture size, its dressed materials are kept and worn again, and
 * `prepare` reads and warms the shapes at load, so a conversation or a fall
 * later uploads nothing and links nothing.
 */
export class HeroCharacter {

	static async create( options = {} ) {

		const animation = options.animation ?? await new GLTFLoader().loadAsync( ANIMATION_URL );

		return new HeroCharacter( { ...options, animation } );

	}

	/** @param textureSize the side the pack's maps are downscaled to, the tier's texture size */
	constructor( { animation, warmup = null, textureSize = TEXTURE_SIZE, loadModel = ( descriptor ) => defaultLoad( descriptor, textureSize ), street = streetBodies } ) {

		this.animation = animation;
		this.street = street;
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
			undress( root );
			return false;

		}

		this.#dropActive();
		person.hero = true;
		root.visible = true;
		this.active = {
			person, root, mixer, descriptor, key: modelKey( descriptor ),
			motions: source.motions,
			playback: null, sequence: 0, currentAction: null, currentClip: null
		};
		mixer.addEventListener( 'finished', ( event ) => this.#finished( mixer, event ) );
		this.#play( sequence, onFinished );

		return true;

	}

	/**
	 * Reads every shape a person can take and builds its programs, so the
	 * first conversation or fall of the run pays for neither.
	 *
	 * @param onProgress receives (done, total) over the shapes
	 */
	async prepare( onProgress = () => {} ) {

		const shapes = [ 'male', 'female' ].map( ( gender ) => avatarFor( gender, 0 ) );

		for ( const [ index, descriptor ] of shapes.entries() ) {

			const source = await this.#model( descriptor );
			const root = characterRoot( source, { position: new THREE.Vector3(), heading: 0, look: PLAIN_LOOK }, `prepared-${descriptor.id}` );
			await this.warmup?.warm( root );
			undress( root );
			onProgress( index + 1, shapes.length );

		}

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
			poseAtCrowdFrame( root, this.animation, source.motions, person );
			if ( samePerson( this.active?.person, person ) ) this.#dropActive();
			ragdoll = Ragdoll.create( { physics, root, impact } );
			this.group.add( root );
			person.hero = true;
			this.fallen = { person, root, ragdoll, descriptor, key: modelKey( descriptor ) };
			this.street.take( person.id );
			return true;

		} catch ( error ) {

			ragdoll?.dispose();
			if ( root ) undress( root );
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

		if ( this.fallen ) this.#fall( delta );
		if ( ! this.active ) return;

		const { person, root, mixer } = this.active;
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		mixer.update( delta );

	}

	/**
	 * Drives the dynamic body and keeps the crowd's own record of this person
	 * on it, so the world knows where they are lying. The fall ends when the
	 * body has stopped moving or its time is up, and the crowd takes them back.
	 */
	#fall( delta ) {

		const { person, ragdoll } = this.fallen;

		ragdoll.update( delta );
		const at = ragdoll.position;
		person.position.set( at.x, person.position.y, at.z );

		if ( ! ragdoll.settled ) return;

		this.street.rest( person.id );
		this.clearFall();

	}

	/** Removes the dynamic body and returns its crowd slot to the caller. */
	clearFall() {

		if ( ! this.fallen ) return null;
		const fallen = this.fallen;
		this.fallen = null;
		fallen.ragdoll.dispose();
		fallen.person.hero = false;
		this.group.remove( fallen.root );
		undress( fallen.root );
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
		undress( root );
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
				clip
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
		const action = active.mixer.clipAction( active.motions.clip( segment.clip ) );
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
				model.motions = new CharacterAnimations( model.scene, this.animation.scene );
				model.wardrobe = [];
				for ( const hair of modelHairs( model ) ) {

					assertRigCompatibility( hair.scene, this.animation.scene );
					attachHair( model.scene, hair.scene );

				}
				return model;

			} ) );

		}

		return this.models.get( key );

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

/** Reconstructs the baked person's authored frame before physics owns it. */
function poseAtCrowdFrame( root, animation, motions, person ) {

	const name = CROWD_CLIP_NAMES[ person.clip ] ?? CROWD_CLIP_NAMES[ 1 ];
	const clip = THREE.AnimationClip.findByName( animation.animations, name );
	if ( ! clip ) throw new Error( `Pro animation library is missing ${name}` );
	const mixer = new THREE.AnimationMixer( root );
	const action = mixer.clipAction( motions.clip( clip ) );
	action.play();
	mixer.setTime( ( ( person.frame ?? 0 ) % FRAMES / FRAMES ) * clip.duration );
	root.updateWorldMatrix( true, true );
	action.paused = true;

}

/** Hands the root's dressed material back to its model's wardrobe. */
function undress( root ) {

	if ( root.userData.dressed ) root.userData.dressed.worn = false;
	root.userData.dressed = null;

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

/**
 * Paints the focused bare base with the same outfit the baked slot wore, in a
 * dressed material the model keeps: one is sewn the first time a root needs
 * it and worn again by the next, its look written into uniforms, so a person
 * shown or fallen never builds a material or drops one.
 */
function dress( root, model, look ) {

	if ( ! look ) return;
	const body = skinnedMesh( root );
	const source = Array.isArray( body.material ) ? body.material[ 0 ] : body.material;
	if ( ! source?.map ) return;

	if ( ! body.geometry.hasAttribute( 'cloth' ) ) body.geometry.setAttribute( 'cloth', garments( body ) );
	const dressed = model.wardrobe.find( ( entry ) => ! entry.worn ) ?? sew( model, body.geometry, source );
	dressed.worn = true;
	dressed.look.skin.value.copy( look.skin );
	dressed.look.shirt.value.copy( look.shirt );
	dressed.look.trousers.value.copy( look.trousers );
	dressed.look.sleeve.value = look.sleeve;
	dressed.look.hem.value = look.hem;
	body.material = dressed.material;
	root.userData.dressed = dressed;

}

function sew( model, geometry, source ) {

	const look = {
		skin: uniform( new THREE.Color() ), shirt: uniform( new THREE.Color() ), trousers: uniform( new THREE.Color() ),
		sleeve: uniform( 0 ), hem: uniform( 0 )
	};
	const material = new MeshStandardNodeMaterial( {
		roughness: source.roughness ?? 0.78,
		metalness: source.metalness ?? 0,
		normalMap: source.normalMap ?? null,
		roughnessMap: source.roughnessMap ?? null
	} );
	material.colorNode = dressedColorNode( geometry, source.map, {
		skin: look.skin, shirt: look.shirt, trousers: look.trousers, cut: vec2( look.sleeve, look.hem )
	} );
	const dressed = { material, look, worn: false };
	model.wardrobe.push( dressed );

	return dressed;

}
