import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ANIMATION_URL, CROWD_CLIP_NAMES, CROWD_MODELS } from './CharacterCatalog.js';
import { CharacterPoser, modelKey } from './CharacterPoser.js';
import { recipeFor } from './Appearance.js';
import { personRecipe } from './avatar/Recipe.js';
import { SpeechGesture } from './SpeechGesture.js';
import { FRAMES } from './VatBaker.js';
import { streetBodies } from './StreetBodies.js';
import { Ragdoll } from '../physics/Ragdoll.js';

const TALK = 'Idle_Talking_Loop';
const SIT_TALK = 'Sitting_Talking_Loop';
const BLEND_MS = 160;
/** Whose recipe a prepared body wears while its programs are built: anybody's does. */
const PREPARED_SEED = 1;

/**
 * One full-quality skinned person while the player is talking to them. The
 * mass-crowd instance stays authoritative until this model is built and its
 * shaders are warm; then that one slot is hidden. There is never more than one
 * focused armature or AnimationMixer updating in the city.
 *
 * The rig is the person in their own recipe (avatar/Recipe.js), the one the
 * crowd paints on its baked body: their body frame, shape, face and height,
 * their hairstyle and colours, and their garments sewn on as skinned shells.
 * It starts in the crowd's clip at the crowd's frame, blending from there into
 * what it plays. A recipe that changes while the rig is resident is worn at
 * once when only its colours changed, and built and swapped in otherwise.
 * While the person's voice plays (`speak`) the rig's head and neck move to it
 * (SpeechGesture).
 *
 * Its bodies come from the CharacterPoser it shares with the still bodies of
 * staged scenes: read once for the run with maps downscaled to the tier's
 * texture size, a person's fit built in steps under the frame budget and kept
 * for the next time, dressed materials kept and worn again. `prepare` reads,
 * refines and warms both crowd bodies and every garment's program at load, so
 * a conversation, a fall or a laid-out body later links nothing.
 */
export class HeroCharacter {

	static async create( options = {} ) {

		const animation = options.animation ?? await new GLTFLoader().loadAsync( ANIMATION_URL );

		return new HeroCharacter( { ...options, animation } );

	}

	/**
	 * @param textureSize the side the pack's maps are downscaled to, the tier's texture size
	 * @param loadModel, loadHair, tailor see CharacterPoser
	 */
	constructor( { animation, warmup = null, textureSize, loadModel, loadHair, tailor, street = streetBodies, lighting = null } ) {

		this.animation = animation;
		this.street = street;
		this.lighting = lighting;
		this.warmup = warmup;
		this.poser = new CharacterPoser( { animation, textureSize, loadModel, loadHair, tailor } );
		this.group = new THREE.Group();
		this.group.name = 'focused-character';
		this.active = null;
		this.fallen = null;
		this.fallPending = false;
		this.request = 0;
		/** Whose voice plays now: `{ npcId, seed, loudness() }`, or null. */
		this.speech = null;

	}

	/**
	 * Loads and swaps one crowd member without ever exposing an unready mesh.
	 * A new rig starts from what the crowd body shows when it takes the slot,
	 * so the caller leaves that body's clip as it is until this resolves.
	 */
	async show( person, segments = null, onFinished = null ) {

		const request = ++ this.request;
		const sequence = this.#resolveSegments( segments ?? defaultSegments( person ) );
		const recipe = recipeOf( person );
		if ( samePerson( this.active?.person, person ) && this.active.key === modelKey( recipe ) ) {

			this.active.person = person;
			this.#wear();
			this.#play( sequence, onFinished );
			return true;

		}
		const source = await this.poser.model( recipe );

		if ( request !== this.request ) {

			this.poser.drop( source );
			return false;

		}

		// A look that changes while the rig warms is worn on the next update.
		const look = person.look;
		const root = this.poser.dress( source, person, `focused-${recipe.body}` );
		const gesture = new SpeechGesture( root );
		this.lighting?.attachRoot( root, person.position );
		root.visible = false;

		const mixer = new THREE.AnimationMixer( root );
		this.group.add( root );
		await this.warmup?.warm( root );

		if ( request !== this.request ) {

			this.group.remove( root );
			mixer.stopAllAction();
			this.lighting?.releaseRoot( root );
			this.poser.release( root );
			return false;

		}

		this.#dropActive();
		person.hero = true;
		root.visible = true;
		this.active = {
			person, look, recipe, root, mixer, gesture, descriptor: source.descriptor, key: source.key,
			height: this.poser.height( root ), motions: source.motions,
			playback: null, sequence: 0, currentAction: null, currentClip: null
		};
		mixer.addEventListener( 'finished', ( event ) => this.#finished( mixer, event ) );
		this.#handOff( person );
		this.#play( sequence, onFinished );

		return true;

	}

	/**
	 * Reads, refines and measures both crowd bodies and builds their programs
	 * with every garment's, so the first conversation or fall of the run
	 * links nothing and prepares no body.
	 *
	 * @param onProgress receives (done, total) over the bodies
	 */
	async prepare( onProgress = () => {} ) {

		for ( const [ index, { gender } ] of CROWD_MODELS.entries() ) {

			// Their height is a rig's, not a program's: the frame's own will do.
			const seeded = personRecipe( { gender, appearanceSeed: PREPARED_SEED } );
			const recipe = { ...seeded, shape: { ...seeded.shape, height: 1 } };
			const source = await this.poser.model( recipe );
			const root = this.poser.dress( source, { position: new THREE.Vector3(), heading: 0 }, `prepared-${recipe.body}` );
			const samples = this.poser.sampleWardrobe( root );
			this.lighting?.attachRoot( root, root.position );
			await this.warmup?.warm( root );
			this.lighting?.releaseRoot( root );
			samples.remove();
			this.poser.release( root );
			onProgress( index + 1, CROWD_MODELS.length );

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
		const recipe = recipeOf( person );
		let source = null;
		let root = null;
		let ragdoll = null;

		try {

			source = await this.poser.model( recipe );
			if ( this.fallen ) {

				this.poser.drop( source );
				return false;

			}
			root = this.poser.dress( source, person, `fallen-${recipe.body}` );
			this.lighting?.attachRoot( root, person.position );
			poseAtCrowdFrame( root, this.animation, source.motions, person );
			// Lengthened before the ragdoll measures its parts off the bones.
			this.poser.height( root )?.afterPose();
			if ( samePerson( this.active?.person, person ) ) this.#dropActive();
			ragdoll = Ragdoll.create( { physics, root, impact } );
			this.group.add( root );
			person.hero = true;
			this.fallen = { person, root, ragdoll, descriptor: source.descriptor, key: source.key };
			this.street.take( person.id );
			return true;

		} catch ( error ) {

			ragdoll?.dispose();
			if ( root ) {

				this.lighting?.releaseRoot( root );
				this.poser.release( root );

			} else if ( source ) this.poser.drop( source );
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

	/**
	 * The person `npcId` is heard: `speech` (`{ seed, loudness() }`) while a
	 * line of theirs plays, null once it ends. Their focused rig moves its head
	 * and neck to it.
	 */
	speak( npcId, speech ) {

		if ( ! npcId ) return;
		if ( speech ) this.speech = { npcId, seed: speech.seed, loudness: speech.loudness };
		else if ( this.speech?.npcId === npcId ) this.speech = null;

	}

	update( delta ) {

		if ( this.fallen ) this.#fall( delta );
		if ( ! this.active ) return;

		const { person, root, mixer, gesture, height } = this.active;
		if ( root.userData.dressed?.presence ) root.userData.dressed.presence.value = person.presence ?? 1;
		if ( person.look !== this.active.look ) this.#wear();
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		this.lighting?.writeRoot( root, person.position );
		height?.beforePose();
		gesture.rest();
		mixer.update( delta );
		height?.afterPose();
		gesture.update( delta, person.npcId && this.speech?.npcId === person.npcId ? this.speech : null );

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
		this.lighting?.writeRoot( this.fallen.root, person.position );

		if ( ! ragdoll.settled ) return;

		this.street.rest( person.id );
		if ( ! person.fallen ) this.clearFall();

	}

	/** Removes the dynamic body and returns its crowd slot to the caller. */
	clearFall() {

		if ( ! this.fallen ) return null;
		const fallen = this.fallen;
		this.fallen = null;
		fallen.ragdoll.dispose();
		fallen.person.hero = false;
		this.group.remove( fallen.root );
		this.lighting?.releaseRoot( fallen.root );
		this.poser.release( fallen.root );
		return fallen.person;

	}

	hide() {

		this.request ++;
		this.#dropActive();

	}

	/**
	 * Wears the active person's current look: its colours on the rig when its
	 * recipe builds the same body, else a rig of the new recipe, built and
	 * swapped in playing what this one plays.
	 */
	#wear() {

		const active = this.active;
		active.look = active.person.look;
		const recipe = recipeOf( active.person );
		if ( modelKey( recipe ) === active.key ) {

			active.recipe = recipe;
			this.poser.wear( active.root, recipe );
			return;

		}
		if ( active.rebuilding === recipe ) return;
		active.rebuilding = recipe;
		const segments = active.currentClip ? [ { clipName: active.currentClip, loop: true } ] : null;
		Promise.resolve( this.show( active.person, segments ) ).catch( ( error ) => console.warn( 'focused character:', error.message ) );

	}

	#dropActive() {

		if ( ! this.active ) return;

		const { person, root, mixer } = this.active;
		person.hero = false;
		mixer.stopAllAction();
		this.group.remove( root );
		this.lighting?.releaseRoot( root );
		this.poser.release( root );
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

	/**
	 * Starts a new rig where the crowd body stood: in the crowd's clip at the
	 * crowd's frame. The first segment blends from it, or carries it on when it
	 * is the same loop.
	 */
	#handOff( person ) {

		const { name, clip, time } = crowdFrame( this.animation, person );
		const action = this.active.mixer.clipAction( this.active.motions.clip( clip ) );
		action.play();
		action.time = time;
		this.active.currentAction = action;
		this.active.currentClip = name;

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
		// A loop asked for again plays on from where it is.
		if ( action !== previous || ! segment.loop ) action.reset();
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

}

/** The recipe the person walks in on the street, or the one their gender and seed give. */
function recipeOf( person ) {

	return person.look?.recipe ?? recipeFor( person ).recipe;

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

/** The clip a crowd body plays and how far into it the body is: its baked frame. */
function crowdFrame( animation, person ) {

	const name = CROWD_CLIP_NAMES[ person.clip ] ?? CROWD_CLIP_NAMES[ 1 ];
	const clip = THREE.AnimationClip.findByName( animation.animations, name );
	if ( ! clip ) throw new Error( `Pro animation library is missing ${name}` );
	return { name, clip, time: ( ( person.frame ?? 0 ) % FRAMES / FRAMES ) * clip.duration };

}

/** Reconstructs the baked person's authored frame before physics owns it. */
function poseAtCrowdFrame( root, animation, motions, person ) {

	const { clip, time } = crowdFrame( animation, person );
	const mixer = new THREE.AnimationMixer( root );
	const action = mixer.clipAction( motions.clip( clip ) );
	action.play();
	mixer.setTime( time );
	root.updateWorldMatrix( true, true );
	action.paused = true;

}
