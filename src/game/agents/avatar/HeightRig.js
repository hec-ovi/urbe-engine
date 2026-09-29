/*
 * Carried over from the NPC Studio (codex_npcs, src/height.js): anatomical
 * height, which lengthens the legs and torso through the shared rig and never
 * scales the character.
 */
import { Matrix4, Vector3 } from 'three/webgpu';
import { HEIGHT_LIMITS } from './Recipe.js';

const LENGTHENED_BONES = new Set( [ 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'spine_01', 'spine_02', 'spine_03' ] );

/**
 * A person's height on one dressed rig. The source rig's segments point along
 * their bones' local Y: the joint offsets below each lengthened bone grow, and
 * the same stretch goes before each of those bones' original inverse binds,
 * so the change spreads along the segment instead of pulling its joint's blend
 * zone. Bone scales stay 1, so head, hands, feet and body width keep their
 * size, and the pelvis drops by what the legs gained, so the animation's
 * lowest ankle stays where it was: standing, bent, crouched or seated.
 *
 * `beforePose` hands the bones back to the clip before the mixer runs and
 * `afterPose` lengthens what the mixer posed. A height of 1 leaves the rig as
 * authored.
 */
export class HeightRig {

	/** @param root a dressed root: its skinned meshes share one skeleton */
	constructor( root, height = 1 ) {

		root.updateMatrixWorld( true );
		const skeletons = new Set();
		let body = null;
		root.traverse( ( mesh ) => {

			if ( ! mesh.isSkinnedMesh ) return;
			skeletons.add( mesh.skeleton );
			if ( ! body || mesh.geometry.attributes.position.count > body.geometry.attributes.position.count ) body = mesh;

		} );
		if ( ! body ) throw new Error( 'height needs a skinned character' );
		const bones = body.skeleton.bones;
		this.root = root;
		this.pelvis = body.skeleton.getBoneByName( 'pelvis' );
		const head = body.skeleton.getBoneByName( 'Head' );
		this.feet = [ 'foot_l', 'foot_r' ].map( ( name ) => body.skeleton.getBoneByName( name ) );
		if ( ! this.pelvis?.parent || ! head || this.feet.some( ( foot ) => ! foot ) ) throw new Error( 'height needs pelvis, head and both foot joints' );
		this.offsets = new Map();
		for ( const bone of bones ) {

			if ( ! LENGTHENED_BONES.has( bone.name ) ) continue;
			for ( const child of bone.children ) if ( child.isBone ) this.offsets.set( child, { bone: child, original: child.position.clone() } );

		}
		const path = ( bone ) => {

			const entries = [];
			for ( let node = bone; node; node = node.parent ) if ( this.offsets.has( node ) ) entries.push( this.offsets.get( node ) );
			return entries;

		};
		this.footPaths = this.feet.map( path );
		const stretchable = growth( path( head ) ) - Math.min( ...this.footPaths.map( growth ) );
		// The bind pose is the rest pose: its bounds are the standing height,
		// with no vertex skinned on the CPU to read it.
		if ( ! body.geometry.boundingBox ) body.geometry.computeBoundingBox();
		const bounds = body.geometry.boundingBox;
		this.restHeight = bounds.max.y - Math.min( 0, bounds.min.y );
		if ( ! ( stretchable > 0 && this.restHeight > 0 ) ) throw new Error( 'the character has no measurable leg and torso height' );
		this.stretchable = stretchable;
		// Clones share the source's inverse binds: those stay untouched, and
		// the lengthened ones are a separate set this rig swaps in.
		this.bindings = [ ...skeletons ].map( ( skeleton ) => ( {
			skeleton, original: skeleton.boneInverses, adjusted: skeleton.boneInverses.map( ( matrix ) => matrix.clone() )
		} ) );
		this.rawPelvis = this.pelvis.position.clone();
		this.height = 1;
		this.factor = 1;
		this.applied = false;
		this.set( height );

	}

	/** Clamped to the authored limits; returns whether it changed. */
	set( value ) {

		if ( ! Number.isFinite( value ) ) return false;
		const next = Math.max( HEIGHT_LIMITS[ 0 ], Math.min( HEIGHT_LIMITS[ 1 ], value ) );
		if ( next === this.height ) return false;
		this.beforePose();
		this.height = next;
		this.factor = 1 + ( next - 1 ) * this.restHeight / this.stretchable;
		const scale = new Matrix4().makeScale( 1, this.factor, 1 );
		for ( const { skeleton, original, adjusted } of this.bindings ) {

			if ( next === 1 ) {

				skeleton.boneInverses = original;
				continue;

			}
			for ( let i = 0; i < adjusted.length; i ++ ) {

				adjusted[ i ].copy( original[ i ] );
				if ( LENGTHENED_BONES.has( skeleton.bones[ i ].name ) ) adjusted[ i ].premultiply( scale );

			}
			skeleton.boneInverses = adjusted;

		}
		this.root.traverse( ( mesh ) => {

			if ( ! mesh.isSkinnedMesh ) return;
			mesh.boundingBox = null;
			mesh.boundingSphere = null;

		} );
		this.afterPose();
		return true;

	}

	/** Hands the lengthened joints back to the clip, before the mixer poses them. */
	beforePose() {

		if ( ! this.applied ) return;
		for ( const { bone, original } of this.offsets.values() ) bone.position.copy( original );
		this.pelvis.position.copy( this.rawPelvis );
		this.applied = false;

	}

	/** Lengthens the pose the clip left, keeping its lowest ankle where it was. */
	afterPose() {

		if ( this.applied ) this.beforePose();
		this.rawPelvis.copy( this.pelvis.position );
		this.root.updateMatrixWorld( true );
		if ( this.height === 1 ) return;
		let originalAnkle = Infinity;
		let changedAnkle = Infinity;
		for ( let i = 0; i < this.feet.length; i ++ ) {

			const ankle = this.feet[ i ].matrixWorld.elements[ 13 ];
			originalAnkle = Math.min( originalAnkle, ankle );
			changedAnkle = Math.min( changedAnkle, ankle + growth( this.footPaths[ i ] ) * ( this.factor - 1 ) );

		}
		for ( const { bone, original } of this.offsets.values() ) {

			bone.position.copy( original );
			bone.position.y *= this.factor;

		}
		const localUp = new Vector3().setFromMatrixColumn( new Matrix4().copy( this.pelvis.parent.matrixWorld ).invert(), 1 );
		this.pelvis.position.addScaledVector( localUp, originalAnkle - changedAnkle );
		this.applied = true;
		this.root.updateMatrixWorld( true );

	}

	/** The rig as authored again, its own inverse binds released. */
	dispose() {

		this.beforePose();
		for ( const { skeleton, original } of this.bindings ) skeleton.boneInverses = original;
		this.root.updateMatrixWorld( true );

	}

}

/** How much higher a chain of lengthened joint offsets carries its end, in world metres per unit of stretch. */
function growth( entries ) {

	return entries.reduce( ( sum, entry ) => sum + entry.bone.parent.matrixWorld.elements[ 5 ] * entry.original.y, 0 );

}
