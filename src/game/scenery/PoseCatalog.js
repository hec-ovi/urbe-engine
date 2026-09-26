import poses from './poses.json' with { type: 'json' };
import { SceneryError } from './SceneryError.js';

/**
 * The poses a staged person can hold: a Pro library clip, the fraction of it
 * the still stands at (1 is its final frame), whether it is a corpse, and the
 * footprint and height the pose is placed with.
 */
export const POSE_IDS = Object.freeze( Object.keys( poses ) );

export function poseOf( poseId ) {

	const pose = poses[ poseId ];
	if ( ! pose ) throw new SceneryError( 'E_SCENERY_INPUT', `unknown pose ${poseId}` );
	return pose;

}

/** Fails when the loaded animation library lacks a clip a pose names. */
export function assertPoseClips( animation ) {

	const names = new Set( ( animation?.animations ?? [] ).map( ( clip ) => clip.name ) );
	const missing = [ ...new Set( POSE_IDS.map( ( id ) => poses[ id ].clip ) ) ].filter( ( clip ) => ! names.has( clip ) );
	if ( missing.length ) throw new SceneryError( 'E_SCENERY_ASSET', `the Pro animation library lacks ${missing.join( ', ' )}` );

}
