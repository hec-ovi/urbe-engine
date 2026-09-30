import * as THREE from 'three/webgpu';
import { CLIP } from './CharacterAssets.js';
import { CROWD_CLIP_NAMES } from './CharacterCatalog.js';
import { clipDuration, transferredClip } from './LayeredClips.js';
import { stepIdle } from './IdleVariety.js';
import { FRAMES } from './VatBaker.js';

/** How fast a rig blends into its next clip, in seconds: as a close rig does. */
const FADE = 0.25;

/**
 * A whole rig at rest that keeps moving: either a person of a role resting
 * as the crowd rests one (IdleVariety: their role's loop and fidgets, at
 * their own pace, from their own phase), or one clip looped from a phase of
 * the rig's own. It owns the rig's mixer: `update(delta)` poses it, blending
 * into each new clip, and lengthens the pose to the person's height.
 */
export class RigIdle {

	/**
	 * @param root a dressed rig (CharacterPoser.dress or still)
	 * @param animation the Pro library (`{ animations }`)
	 * @param motions the rig's body's CharacterAnimations
	 * @param height the rig's HeightRig, or null at its frame's own height
	 * @param rest `{ type, activity, appearanceSeed, seated? }` for a person resting in their role's way, or `{ loop, appearanceSeed }` for one clip looped
	 */
	constructor( { root, animation, motions, height = null, rest } ) {

		this.root = root;
		this.animation = animation;
		this.motions = motions;
		this.height = height;
		this.mixer = new THREE.AnimationMixer( root );
		this.action = null;
		this.clipName = null;
		const seed = rest.appearanceSeed >>> 0;
		this.loop = rest.loop ?? null;
		this.person = rest.loop ? null : {
			type: rest.type, activity: rest.activity, appearanceSeed: seed,
			clip: rest.seated ? CLIP.SIT : CLIP.IDLE, frame: ( seed % 4093 ) / 4093 * FRAMES
		};
		this.durations = this.person ? CROWD_CLIP_NAMES.map( ( name ) => clipDuration( animation.animations, name ) ) : null;
		if ( this.loop ) {

			this.#play( this.loop );
			this.action.time = ( ( seed % 4093 ) / 4093 ) * this.action.getClip().duration;

		}

	}

	/** The clip the rig plays now. */
	get playing() {

		return this.clipName;

	}

	update( delta ) {

		if ( this.person ) {

			const shown = stepIdle( this.person, delta, this.durations );
			const name = CROWD_CLIP_NAMES[ shown ];
			if ( name !== this.clipName ) this.#play( name );

		}
		this.height?.beforePose();
		this.mixer.update( delta );
		if ( this.person ) {

			// The person's frame is the clock, as a crowd body's is.
			this.action.time = ( this.person.frame / FRAMES ) * this.action.getClip().duration;
			this.mixer.update( 0 );

		}
		this.height?.afterPose();

	}

	dispose() {

		this.mixer.stopAllAction();
		this.mixer.uncacheRoot( this.root );

	}

	#play( name ) {

		const clip = transferredClip( this.animation.animations, this.motions, name );
		if ( ! clip ) throw new Error( `Pro animation library is missing ${name}` );
		const action = this.mixer.clipAction( clip );
		action.reset().setLoop( THREE.LoopRepeat, Infinity ).play();
		if ( this.action && this.action !== action ) action.crossFadeFrom( this.action, FADE, true );
		this.action = action;
		this.clipName = name;

	}

}
