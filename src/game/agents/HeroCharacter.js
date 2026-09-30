import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ANIMATION_URL, CROWD_CLIP_NAMES, CROWD_MODELS } from './CharacterCatalog.js';
import { CLIP } from './CharacterAssets.js';
import { CharacterPoser, modelKey } from './CharacterPoser.js';
import { recipeFor } from './Appearance.js';
import { personRecipe } from './avatar/Recipe.js';
import { Tailor } from './avatar/Tailor.js';
import { SpeechGesture } from './SpeechGesture.js';
import { LookAt } from './LookAt.js';
import { FRAMES } from './VatBaker.js';
import { hasClip, transferredClip } from './LayeredClips.js';
import { streetBodies } from './StreetBodies.js';
import { Ragdoll } from '../physics/Ragdoll.js';

const TALK = 'Idle_Talking_Loop';
/** How many people near the player wear their whole recipe besides the one being talked to. */
export const CLOSE_RIGS = 2;
/** How fast a close rig blends into the crowd body's next clip, in seconds. */
const CLOSE_FADE = 0.25;
const SIT_TALK = 'Sitting_Talking_Loop';
const BLEND_MS = 160;
/** Whose recipe a prepared body wears while its programs are built: anybody's does. */
const PREPARED_SEED = 1;

/**
 * One full-quality skinned person while the player is talking to them, and
 * the few standing nearest the player (`near`). The mass-crowd instance stays
 * authoritative until a model is built and its shaders are warm; then that
 * one slot is hidden. There is never more than one focused armature, and
 * never more than CLOSE_RIGS close ones, updating in the city; a close person
 * who is talked to hands their rig to the talk, and keeps it after while they
 * stay close.
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
	 * @param slice the frame budget a person's fit is built under (FrameBudget)
	 * @param loadModel, loadHair, tailor see CharacterPoser
	 */
	constructor( { animation, warmup = null, textureSize, slice = null, loadModel, loadHair, tailor = new Tailor( { slice } ), street = streetBodies, lighting = null } ) {

		this.animation = animation;
		this.street = street;
		this.lighting = lighting;
		this.warmup = warmup;
		this.poser = new CharacterPoser( { animation, textureSize, loadModel, loadHair, tailor } );
		this.group = new THREE.Group();
		this.group.name = 'focused-character';
		this.active = null;
		/** The people near the player in their whole recipe: crowd member to rig. */
		this.close = new Map();
		/** Who the host last asked to be close (`near`): the focused rig stays one of them when a talk ends. */
		this.nearby = new Set();
		this.fallen = null;
		this.fallPending = false;
		this.request = 0;
		/** Whose voice plays now: `{ npcId, seed, loudness() }`, or null. */
		this.speech = null;
		/** Who looks at the player now, and the point they look at (`lookAt`). */
		this.watched = null;
		this.watchPoint = null;

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
		// A person already standing close in this recipe is handed over as they are.
		const close = this.#closeOf( person );
		if ( close?.root && close.key === modelKey( recipe ) ) {

			this.close.delete( close.person );
			this.#dropActive();
			person.hero = true;
			this.active = {
				person, look: person.look, recipe, root: close.root, mixer: close.mixer, gesture: new SpeechGesture( close.root ), gaze: close.gaze ?? new LookAt( close.root ),
				descriptor: close.descriptor, key: close.key, height: close.height, motions: close.motions,
				playback: null, sequence: 0, currentAction: close.action, currentClip: close.clipName
			};
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
		const gaze = new LookAt( root );
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
		this.#dropClose( person );
		person.hero = true;
		root.visible = true;
		this.active = {
			person, look, recipe, root, mixer, gesture, gaze, descriptor: source.descriptor, key: source.key,
			height: this.poser.height( root ), motions: source.motions,
			playback: null, sequence: 0, currentAction: null, currentClip: null
		};
		mixer.addEventListener( 'finished', ( event ) => this.#finished( mixer, event ) );
		this.#handOff( person );
		this.#play( sequence, onFinished );

		return true;

	}

	/**
	 * Reads, refines and measures both crowd bodies, transfers the clips a
	 * close or talking person plays onto them, and builds their programs with
	 * every garment's, so the first conversation, close person or fall of the
	 * run links nothing and prepares no body.
	 *
	 * @param onProgress receives (done, total) over the bodies
	 */
	async prepare( onProgress = () => {} ) {

		for ( const [ index, { gender } ] of CROWD_MODELS.entries() ) {

			// Their height is a rig's, not a program's: the frame's own will do.
			const seeded = personRecipe( { gender, appearanceSeed: PREPARED_SEED } );
			const recipe = { ...seeded, shape: { ...seeded.shape, height: 1 } };
			const source = await this.poser.model( recipe );
			for ( const name of [ ...CROWD_CLIP_NAMES, TALK, SIT_TALK ] ) {

				if ( hasClip( this.animation.animations, name ) ) transferredClip( this.animation.animations, source.motions, name );

			}
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
			this.#dropClose( person );
			root = this.poser.dress( source, person, `fallen-${recipe.body}` );
			this.lighting?.attachRoot( root, person.position );
			poseAtCrowdFrame( root, this.animation, source.motions, person );
			// Lengthened before the ragdoll measures its parts off the bones.
			this.poser.height( root )?.afterPose();
			// Down, they are nobody's close person: the talk's rig goes, never back to them.
			this.nearby = new Set( [ ...this.nearby ].filter( ( near ) => ! samePerson( near, person ) ) );
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
	 * The person the player talks to looks at `point` (the player's eye, a
	 * vector the host keeps moving), and nobody does once `person` is null.
	 * Their focused rig turns its upper spine, neck and head toward it from
	 * the pose its clip holds (LookAt): round from a chair, and up and down
	 * to the eye when standing, facing the player already.
	 */
	lookAt( person, point = null ) {

		this.watched = point ? person : null;
		this.watchPoint = point;

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

	/**
	 * The people who should stand near the player in their whole recipe now,
	 * nearest first: up to CLOSE_RIGS of them wear a rig of their own, built
	 * while their crowd body still shows and following that body's place, clip
	 * and frame, so neither swap shows a pose change. Anybody else close gives
	 * theirs back. The person being talked to counts among them, in the rig
	 * the talk shows; a fallen one is not close, their own rig shows them.
	 *
	 * @param people crowd members, their `hero` left to this
	 */
	near( people ) {

		// The person talked to counts among the close, in the rig the talk shows.
		const chosen = people.filter( ( person ) => ! samePerson( this.fallen?.person, person ) ).slice( 0, CLOSE_RIGS );
		this.nearby = new Set( chosen );
		for ( const person of [ ...this.close.keys() ] ) if ( ! this.nearby.has( person ) ) this.#dropClose( person );
		for ( const person of chosen ) {

			if ( this.close.has( person ) || samePerson( this.active?.person, person ) ) continue;
			this.#dress( person ).catch( ( error ) => console.warn( 'close character:', error.message ) );

		}

	}

	/** The rig showing a person now, focused or close, or null: `{ root, descriptor }`. */
	rigOf( person ) {

		if ( samePerson( this.active?.person, person ) ) return this.active;
		const close = this.#closeOf( person );
		return close?.root ? close : null;

	}

	update( delta ) {

		if ( this.fallen ) this.#fall( delta );
		for ( const close of this.close.values() ) if ( close.root ) this.#follow( close, delta );
		if ( ! this.active ) return;

		const { person, root, mixer, gesture, gaze, height } = this.active;
		if ( root.userData.dressed ) root.userData.dressed.presence = person.presence ?? 1;
		if ( person.look !== this.active.look ) this.#wear();
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		this.lighting?.writeRoot( root, person.position );
		height?.beforePose();
		gesture.rest();
		gaze.rest();
		mixer.update( delta );
		height?.afterPose();
		gaze.update( delta, samePerson( this.watched, person ) ? this.watchPoint : null );
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
		// A person still close when the talk ends stays in the rig they wore.
		if ( this.nearby.has( person ) && ! this.close.has( person ) ) {

			const { descriptor, key, height, motions, gaze, currentAction: action, currentClip: clipName } = this.active;
			this.close.set( person, { person, root, mixer, descriptor, key, height, motions, gaze, action, clipName, recipe: this.active.recipe } );
			this.active = null;
			return;

		}
		person.hero = false;
		mixer.stopAllAction();
		this.group.remove( root );
		this.lighting?.releaseRoot( root );
		this.poser.release( root );
		this.active = null;

	}

	/** A close person's rig, built while their crowd body shows them and swapped in once warm. */
	async #dress( person ) {

		const recipe = recipeOf( person );
		const entry = { person, root: null, recipe };
		this.close.set( person, entry );
		let source = null;
		try {

			source = await this.poser.model( recipe );

		} catch ( error ) {

			if ( this.close.get( person ) === entry ) this.close.delete( person );
			throw error;

		}
		if ( this.close.get( person ) !== entry || person.hero ) {

			this.poser.drop( source );
			if ( this.close.get( person ) === entry ) this.close.delete( person );
			return;

		}
		const root = this.poser.dress( source, person, `close-${recipe.body}` );
		this.lighting?.attachRoot( root, person.position );
		root.visible = false;
		this.group.add( root );
		await this.warmup?.warm( root );
		if ( this.close.get( person ) !== entry || person.hero ) {

			this.group.remove( root );
			this.lighting?.releaseRoot( root );
			this.poser.release( root );
			if ( this.close.get( person ) === entry ) this.close.delete( person );
			return;

		}
		Object.assign( entry, {
			root, mixer: new THREE.AnimationMixer( root ), descriptor: source.descriptor, key: source.key,
			height: this.poser.height( root ), motions: source.motions, action: null, clipName: null
		} );
		entry.mixer.addEventListener( 'finished', ( event ) => this.#finished( entry.mixer, event ) );
		person.hero = true;
		root.visible = true;
		this.#follow( entry, 0 );

	}

	/** A close rig where its crowd body is, in its clip at its frame, blending into a new clip. */
	#follow( close, delta ) {

		const { person, root, mixer, height } = close;
		if ( root.userData.dressed ) root.userData.dressed.presence = person.presence ?? 1;
		if ( person.look !== close.look ) {

			close.look = person.look;
			if ( modelKey( recipeOf( person ) ) === close.key ) this.poser.wear( root, recipeOf( person ) );

		}
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		this.lighting?.writeRoot( root, person.position );
		const { name, clip, time } = crowdFrame( this.animation, close.motions, person );
		height?.beforePose();
		if ( close.clipName !== name ) {

			const action = mixer.clipAction( clip );
			action.reset().setLoop( THREE.LoopRepeat, Infinity ).play();
			if ( close.action && close.action !== action ) action.crossFadeFrom( close.action, close.clipName ? CLOSE_FADE : 0, true );
			close.action = action;
			close.clipName = name;

		}
		close.gaze?.rest();
		mixer.update( delta );
		// The crowd's frame is the clock: the rig shows the pose the body would.
		close.action.time = time;
		mixer.update( 0 );
		height?.afterPose();
		// A look a talk left on this rig eases back to the clip.
		close.gaze?.update( delta, null );

	}

	/** Gives a close person's rig back; their crowd body shows them again unless another rig now does. */
	#dropClose( person ) {

		const close = this.#closeOf( person );
		if ( ! close ) return;
		this.close.delete( close.person );
		if ( ! close.root ) return;
		close.mixer.stopAllAction();
		this.group.remove( close.root );
		this.lighting?.releaseRoot( close.root );
		this.poser.release( close.root );
		if ( ! samePerson( this.active?.person, close.person ) ) close.person.hero = false;

	}

	#closeOf( person ) {

		if ( this.close.has( person ) ) return this.close.get( person );
		for ( const close of this.close.values() ) if ( samePerson( close.person, person ) ) return close;
		return null;

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

		const { name, clip, time } = crowdFrame( this.animation, this.active.motions, person );
		const action = this.active.mixer.clipAction( clip );
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
		clipName: person.clip === CLIP.SIT || person.clip === CLIP.SIT_TALK ? SIT_TALK : TALK,
		loop: true,
		blendMs: BLEND_MS
	} ];

}

function samePerson( left, right ) {

	if ( ! left || ! right ) return false;
	if ( left === right ) return true;
	return Boolean( left.npcId && right.npcId && left.npcId === right.npcId );

}

/**
 * The clip a crowd body shows, transferred onto a rig's body, and how far
 * into it the body is: its baked frame. What it shows is its idle variety's
 * clip while it rests (`shown`), else its posture's.
 */
function crowdFrame( animation, motions, person ) {

	const name = CROWD_CLIP_NAMES[ person.shown ?? person.clip ] ?? CROWD_CLIP_NAMES[ 1 ];
	const clip = transferredClip( animation.animations, motions, name );
	if ( ! clip ) throw new Error( `Pro animation library is missing ${name}` );
	return { name, clip, time: ( ( person.frame ?? 0 ) % FRAMES / FRAMES ) * clip.duration };

}

/** Reconstructs the baked person's authored frame before physics owns it. */
function poseAtCrowdFrame( root, animation, motions, person ) {

	const { clip, time } = crowdFrame( animation, motions, person );
	const mixer = new THREE.AnimationMixer( root );
	const action = mixer.clipAction( clip );
	action.play();
	mixer.setTime( time );
	root.updateWorldMatrix( true, true );
	action.paused = true;

}
