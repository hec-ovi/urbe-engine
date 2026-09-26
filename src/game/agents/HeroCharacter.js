import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ANIMATION_URL, CROWD_CLIP_NAMES, CROWD_MODELS, avatarFor } from './CharacterCatalog.js';
import { CharacterPoser, modelKey } from './CharacterPoser.js';
import { SpeechGesture } from './SpeechGesture.js';
import { FRAMES } from './VatBaker.js';
import { streetBodies } from './StreetBodies.js';
import { Ragdoll } from '../physics/Ragdoll.js';

const TALK = 'Idle_Talking_Loop';
const SIT_TALK = 'Sitting_Talking_Loop';
const BLEND_MS = 160;
const WHITE = new THREE.Color( 1, 1, 1 );
/** What a prepared shape wears while its programs are built: every channel a person's look has. */
const PLAIN_LOOK = { skin: WHITE, shirt: WHITE, trousers: WHITE, hair: WHITE, sleeve: 0, hem: 0 };

/**
 * One full-quality skinned person while the player is talking to them. The
 * mass-crowd instance stays authoritative until this model is loaded and its
 * shaders are warm; then that one slot is hidden. There is never more than one
 * focused armature or AnimationMixer updating in the city.
 *
 * The rig is the crowd body the person walks in: the same variant, the same
 * painted outfit, the same hair tint on hairstyle and eyebrows and the same
 * surface response, and it starts in the crowd's clip at the crowd's frame,
 * blending from there into what it plays, so the swap is not seen. A look that
 * changes while the rig is resident is worn at once. While the person's voice
 * plays (`speak`) the rig's head and neck move to it (SpeechGesture).
 *
 * Its shapes come from the CharacterPoser it shares with the still bodies of
 * staged scenes: read once for the run with maps downscaled to the tier's
 * texture size, dressed materials kept and worn again. `prepare` reads and
 * warms the shapes at load, so a conversation, a fall or a laid-out body
 * later uploads nothing and links nothing.
 */
export class HeroCharacter {

	static async create( options = {} ) {

		const animation = options.animation ?? await new GLTFLoader().loadAsync( ANIMATION_URL );

		return new HeroCharacter( { ...options, animation } );

	}

	/** @param textureSize the side the pack's maps are downscaled to, the tier's texture size */
	constructor( { animation, warmup = null, textureSize, loadModel, street = streetBodies, lighting = null } ) {

		this.animation = animation;
		this.street = street;
		this.lighting = lighting;
		this.warmup = warmup;
		this.poser = new CharacterPoser( { animation, textureSize, loadModel } );
		this.group = new THREE.Group();
		this.group.name = 'focused-character';
		this.active = null;
		this.fallen = null;
		this.fallPending = false;
		this.request = 0;
		/** Whose voice plays now: `{ npcId, seed, loudness() }`, or null. */
		this.speech = null;

	}

	/** Loads and swaps one crowd member without ever exposing an unready mesh. */
	async show( person, segments = null, onFinished = null ) {

		const request = ++ this.request;
		const sequence = this.#resolveSegments( segments ?? defaultSegments( person ) );
		const descriptor = avatarFor( person.variant );
		if ( samePerson( this.active?.person, person ) && this.active.key === modelKey( descriptor ) ) {

			this.active.person = person;
			this.#wear();
			this.#play( sequence, onFinished );
			return true;

		}
		const source = await this.poser.model( descriptor );

		if ( request !== this.request ) return false;

		// A look that changes while the rig warms is worn on the next update.
		const look = person.look;
		const root = this.poser.dress( source, person, `focused-${descriptor.id}` );
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
			person, look, root, mixer, gesture, descriptor, key: modelKey( descriptor ),
			motions: source.motions,
			playback: null, sequence: 0, currentAction: null, currentClip: null
		};
		mixer.addEventListener( 'finished', ( event ) => this.#finished( mixer, event ) );
		this.#handOff( person );
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

		const shapes = CROWD_MODELS.map( ( _, variant ) => avatarFor( variant ) );

		for ( const [ index, descriptor ] of shapes.entries() ) {

			const source = await this.poser.model( descriptor );
			const root = this.poser.dress( source, { position: new THREE.Vector3(), heading: 0, look: PLAIN_LOOK }, `prepared-${descriptor.id}` );
			this.lighting?.attachRoot( root, root.position );
			await this.warmup?.warm( root );
			this.lighting?.releaseRoot( root );
			this.poser.release( root );
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
		const descriptor = avatarFor( person.variant );
		let root = null;
		let ragdoll = null;

		try {

			const source = await this.poser.model( descriptor );
			if ( this.fallen ) return false;
			root = this.poser.dress( source, person, `fallen-${descriptor.id}` );
			this.lighting?.attachRoot( root, person.position );
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
			if ( root ) {

				this.lighting?.releaseRoot( root );
				this.poser.release( root );

			}
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

		const { person, root, mixer, gesture } = this.active;
		if ( person.look !== this.active.look ) this.#wear();
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		this.lighting?.writeRoot( root, person.position );
		gesture.rest();
		mixer.update( delta );
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
		this.lighting?.releaseRoot( fallen.root );
		this.poser.release( fallen.root );
		return fallen.person;

	}

	hide() {

		this.request ++;
		this.#dropActive();

	}

	/** Writes the active person's current look into the uniforms its rig is dressed with. */
	#wear() {

		const active = this.active;
		active.look = active.person.look;
		this.poser.wear( active.root, active.look );

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
