import { AnimationClip } from 'three/webgpu';
import { LAYERED_CLIPS } from './CharacterCatalog.js';

/** The bones a layer moves, by the part of the body it is. Later layers win. */
const PARTS = {
	// The shoulders, arms and hands.
	arms: /^(?:clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|pinky_|ring_|thumb_)/,
	// The neck and head, which turn to look while the body keeps its pose.
	head: /^(?:neck_01|Head)\./,
	// The chest up: the upper spine with the arms and head.
	upper: /^(?:spine_0[23]|neck_01|Head|clavicle_|upperarm_|lowerarm_|hand_|index_|middle_|pinky_|ring_|thumb_)/
};

/** Each body's layered clips, made once: CharacterAnimations to name to clip. */
const made = new WeakMap();

/**
 * One clip made of others: `base` moves the whole body and each layer then
 * moves its part of it (`PARTS`) as its own clip does, or holds that part in
 * the pose its clip has at `at` (0 to 1 of it). The clips are transferred onto
 * one body (CharacterAnimations), so their tracks name the same bones. It
 * lasts as long as the longest clip it plays; a shorter one holds its last
 * pose, which for a loop is its first.
 *
 * @param base a clip
 * @param layers `[{ part, clip, at? }]`
 */
export function layeredClip( name, base, layers ) {

	const tracks = new Map( base.tracks.map( ( track ) => [ track.name, track ] ) );
	let duration = base.duration;
	for ( const { part, clip, at } of layers ) {

		const bones = PARTS[ part ];
		if ( ! bones ) throw new Error( `no ${part} layer` );
		for ( const track of clip.tracks ) {

			if ( bones.test( track.name ) ) tracks.set( track.name, at === undefined ? track : held( track, at * clip.duration ) );

		}
		if ( at === undefined ) duration = Math.max( duration, clip.duration );

	}
	return new AnimationClip( name, duration, [ ...tracks.values() ] );

}

/**
 * The clip `name` transferred onto one body: the library's own, or the one
 * LAYERED_CLIPS makes of the library's; null when neither has it.
 *
 * @param animations the library's clips
 * @param motions the body's CharacterAnimations, whose `clip(original)` transfers one
 */
export function transferredClip( animations, motions, name ) {

	const own = AnimationClip.findByName( animations, name );
	if ( own ) return motions.clip( own );
	const recipe = LAYERED_CLIPS[ name ];
	if ( ! recipe ) return null;
	let clips = made.get( motions );
	if ( ! clips ) made.set( motions, clips = new Map() );
	if ( ! clips.has( name ) ) {

		const part = ( clipName ) => {

			const clip = transferredClip( animations, motions, clipName );
			if ( ! clip ) throw new Error( `Pro animation library is missing ${clipName}` );
			return clip;

		};
		clips.set( name, layeredClip( name, part( recipe.base ), recipe.layers.map( ( layer ) => ( { part: layer.part, clip: part( layer.clip ), at: layer.at } ) ) ) );

	}
	return clips.get( name );

}

/** Whether the library has `name`, or can make it from its own clips. */
export function hasClip( animations, name ) {

	const recipe = LAYERED_CLIPS[ name ];
	return Boolean( AnimationClip.findByName( animations, name ) ) ||
		Boolean( recipe && [ recipe.base, ...recipe.layers.map( ( layer ) => layer.clip ) ].every( ( part ) => hasClip( animations, part ) ) );

}

/** A track standing still at its value at `time`. */
function held( track, time ) {

	const value = track.createInterpolant().evaluate( time );
	const Track = track.constructor;
	return new Track( track.name, [ 0 ], Array.from( value ) );

}
