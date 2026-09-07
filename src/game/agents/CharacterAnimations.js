import { Vector3 } from 'three/webgpu';
import { clone, retargetClip } from 'three/addons/utils/SkeletonUtils.js';
import { assertRigCompatibility } from './CharacterCatalog.js';

/** Transfers Pro motion onto a Source body's proportions without editing either asset. */
export class CharacterAnimations {

	constructor( characterRoot, animationRoot ) {

		assertRigCompatibility( characterRoot, animationRoot );
		this.target = rigOf( clone( characterRoot ) );
		this.source = rigOf( clone( animationRoot ) );
		this.clips = new Map();
		const targetHip = this.target.skeleton.getBoneByName( 'pelvis' );
		const sourceHip = this.source.skeleton.getBoneByName( 'pelvis' );
		this.scale = targetHip && sourceHip
			? targetHip.getWorldPosition( new Vector3() ).y / sourceHip.getWorldPosition( new Vector3() ).y
			: 1;

	}

	clip( original ) {

		if ( this.clips.has( original ) ) return this.clips.get( original );
		const inPlace = original.clone();
		inPlace.tracks = inPlace.tracks.filter( ( track ) => track.name !== 'root.position' );
		const intervals = Math.max( 1, ...inPlace.tracks.map( ( track ) => track.times.length - 1 ) );
		const subdivisions = Math.max( 1, Math.ceil( 30 * original.duration / intervals ) );
		const clip = retargetClip( this.target, this.source.skeleton, inPlace, {
			hip: 'pelvis',
			getBoneName: ( bone ) => bone.name,
			preserveBonePositions: true,
			scale: this.scale,
			// retargetClip counts samples, including both endpoints. Subdivide the authored grid.
			fps: ( intervals * subdivisions + 1 ) / original.duration
		} );
		// The mixer owns the complete scene, including eyes and eyebrows.
		for ( const track of clip.tracks ) track.name = track.name.replace( /^\.bones\[([^\]]+)\]\./, '$1.' );
		clip.duration = original.duration;
		this.clips.set( original, clip );
		return clip;

	}

}

function rigOf( root ) {

	root.updateMatrixWorld( true );
	let rig = null;
	root.traverse( ( node ) => {

		if ( node.isSkinnedMesh && ( ! rig || node.skeleton.bones.length > rig.skeleton.bones.length ) ) rig = node;

	} );
	return rig;

}
