import * as THREE from 'three/webgpu';
import { lookOf } from './Appearance.js';
import { SLOTS, defaultRecipe } from './avatar/Recipe.js';
import { bodyOf } from './avatar/BodyShape.js';
import { fitKey } from './avatar/Tailor.js';
import { CROWD_CLIP_NAMES, LAYERED_CLIPS } from './CharacterCatalog.js';

const X = new THREE.Vector3( 1, 0, 0 );

/** A skinned model named `name`, with the glTF body's eyebrows beside it when `eyebrows`. */
export function rig( name = 'body', { eyebrows = false } = {} ) {

	const root = new THREE.Group();
	const bone = new THREE.Bone();
	bone.name = 'root';
	const head = new THREE.Bone();
	head.name = 'Head';
	bone.add( head );
	const skeleton = new THREE.Skeleton( [ bone, head ] );
	const skinned = ( meshName, vertices ) => {

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( Array( vertices * 3 ).fill( 0 ), 3 ) );
		geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( Array( vertices * 4 ).fill( 0 ), 4 ) );
		geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( Array( vertices ).fill( [ 1, 0, 0, 0 ] ).flat(), 4 ) );
		// The pack's surfaces carry relief and roughness maps besides colour.
		const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshStandardMaterial( {
			map: new THREE.Texture(), normalMap: new THREE.Texture(), roughnessMap: new THREE.Texture()
		} ) );
		mesh.name = meshName;
		return mesh;

	};
	const mesh = skinned( name, 2 );
	mesh.add( bone );
	mesh.bind( skeleton );
	root.add( mesh );
	if ( eyebrows ) {

		const brows = skinned( 'Eyebrows', 1 );
		brows.bind( skeleton );
		root.add( brows );

	}

	return root;

}

/**
 * The crowd's clips, the talk, sit and sprint clips a focused rig plays and a
 * death a still lies in, on the test rig's skeleton; each a second long.
 * `turns` names clips, these or others, whose root turns about +X from one
 * angle (radians) at their first frame to another at their last, so a pose
 * tells which clip played and how far in: `{ Crouch_Enter: [ 0, 1 ] }`.
 */
export function animation( turns = {}, scene = rig() ) {

	const times = [ 0, 1 ];
	const clip = ( name, from = 0, to = 0 ) => new THREE.AnimationClip( name, 1, [ new THREE.QuaternionKeyframeTrack( 'root.quaternion', times, [
		...new THREE.Quaternion().setFromAxisAngle( X, from ).toArray(), ...new THREE.Quaternion().setFromAxisAngle( X, to ).toArray()
	] ) ] );
	const names = new Set( [
		...CROWD_CLIP_NAMES.filter( ( name ) => ! LAYERED_CLIPS[ name ] ), 'Sprint_Enter', ...Object.keys( turns )
	] );

	return {
		scene,
		animations: [
			...[ ...names ].map( ( name ) => clip( name, ...( turns[ name ] ?? [] ) ) ),
			// Falls a quarter turn about +X over its second, as a body lies down.
			clip( 'Death01', 0, Math.PI / 2 )
		]
	};

}

/** How far the root of `root`, a dressed test rig, is turned about +X, in radians. */
export function rootTurn( root ) {

	const { x, w } = root.getObjectByName( 'root' ).quaternion;
	return 2 * Math.atan2( x, w );

}

/**
 * A crowd person's look: a whole recipe on the regular body of `gender`, at
 * the frame's own height, its colours `colors` and its garments `outfit`
 * over the studio's defaults.
 */
export function outfit( gender = 'male', { colors = {}, outfit: garments = {} } = {} ) {

	const recipe = defaultRecipe( `regular-${gender}` );
	recipe.colors = { ...recipe.colors, ...colors };
	recipe.outfit = { ...recipe.outfit, ...garments, colors: { ...recipe.outfit.colors, ...garments.colors } };
	return lookOf( recipe );

}

/**
 * A tailor for the test rigs, which have no anatomy to fit: a person's body
 * is the rig's own geometry, and each garment their recipe names is one
 * skinned triangle in a garment's vertex layout. Fits are kept by recipe and
 * counted out as the real tailor counts them.
 */
export function plainTailor() {

	return {
		prepared: [],
		fits: new Map(),
		prepare( model ) {

			if ( ! this.prepared.includes( model ) ) this.prepared.push( model );
			return Promise.resolve( {} );

		},
		async fit( model, recipe ) {

			const key = `${model.descriptor?.id}|${fitKey( recipe )}`;
			if ( ! this.fits.has( key ) ) {

				this.fits.set( key, {
					key, body: bodyOf( model.scene ).geometry, auxiliaries: new Map(), hidden: 0, users: 0,
					garments: SLOTS.filter( ( slot ) => recipe.outfit[ slot ] !== 'none' ).map( ( slot ) => ( { id: recipe.outfit[ slot ], slot, geometry: shell() } ) )
				} );

			}
			const fit = this.fits.get( key );
			fit.users ++;
			return fit;

		},
		release( fit ) {

			if ( fit ) fit.users --;

		}
	};

}

/** Options for a HeroCharacter over the test rigs: a body with eyebrows, a hairstyle, the plain tailor. */
export function heroRigs( overrides = {} ) {

	return {
		animation: animation(),
		tailor: plainTailor(),
		loadModel: () => ( { scene: rig( 'body', { eyebrows: true } ) } ),
		loadHair: () => ( { scene: rig( 'hair' ) } ),
		...overrides
	};

}

function shell() {

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 1, 0, 0.1, 1, 0, 0, 1.1, 0 ], 3 ) );
	geometry.setAttribute( 'normal', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
	geometry.setAttribute( 'garmentSurface', new THREE.Float32BufferAttribute( [ 0, 0.6, 0, 0.05, 0.6, 0, 0, 0.65, 0 ], 3 ) );
	geometry.setAttribute( 'garmentNormal', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 0, 1, 0, 0, 1 ], 3 ) );
	geometry.setAttribute( 'garmentShares', new THREE.Float32BufferAttribute( Array( 12 ).fill( 0 ), 4 ) );
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( Array( 12 ).fill( 0 ), 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0 ], 4 ) );
	geometry.setIndex( [ 0, 1, 2 ] );
	return geometry;

}

/**
 * A rig with the Source skeleton's named joints, standing 1.8 m tall: enough
 * anatomy for a ragdoll and for height, and a Head for a hairstyle.
 */
export function humanoid( { eyebrows = false } = {} ) {

	const root = new THREE.Group();
	const armature = namedBone( 'root', [ 0, 0, 0 ] );
	const pelvis = namedBone( 'pelvis', [ 0, 0.95, 0 ] );
	armature.add( pelvis );
	root.add( armature );
	const spine1 = namedBone( 'spine_01', [ 0, 0.14, 0 ] );
	const spine2 = namedBone( 'spine_02', [ 0, 0.12, 0 ] );
	const spine3 = namedBone( 'spine_03', [ 0, 0.14, 0 ] );
	const neck = namedBone( 'neck_01', [ 0, 0.14, 0 ] );
	const head = namedBone( 'Head', [ 0, 0.1, 0 ] );
	pelvis.add( spine1 );
	spine1.add( spine2 );
	spine2.add( spine3 );
	spine3.add( neck );
	neck.add( head );
	addArm( spine3, 'l', 1 );
	addArm( spine3, 'r', - 1 );
	addLeg( pelvis, 'l', 1 );
	addLeg( pelvis, 'r', - 1 );

	const bones = [];
	root.traverse( ( node ) => { if ( node.isBone ) bones.push( node ); } );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [ 0, 0, 0, 0, 1.8, 0 ], 3 ) );
	geometry.setAttribute( 'skinIndex', new THREE.Uint16BufferAttribute( [ 0, 0, 0, 0, 0, 0, 0, 0 ], 4 ) );
	geometry.setAttribute( 'skinWeight', new THREE.Float32BufferAttribute( [ 1, 0, 0, 0, 1, 0, 0, 0 ], 4 ) );
	const skeleton = new THREE.Skeleton( bones );
	const mesh = new THREE.SkinnedMesh( geometry, new THREE.MeshStandardMaterial( { map: new THREE.Texture() } ) );
	mesh.name = 'body';
	mesh.add( armature );
	mesh.bind( skeleton );
	root.add( mesh );
	if ( eyebrows ) {

		const brows = new THREE.SkinnedMesh( geometry.clone(), new THREE.MeshStandardMaterial( { map: new THREE.Texture() } ) );
		brows.name = 'Eyebrows';
		brows.bind( skeleton );
		root.add( brows );

	}
	root.updateWorldMatrix( true, true );
	return root;

}

function addArm( parent, side, direction ) {

	const clavicle = namedBone( `clavicle_${side}`, [ direction * 0.08, 0.06, 0 ] );
	const upper = namedBone( `upperarm_${side}`, [ direction * 0.12, 0, 0 ] );
	const lower = namedBone( `lowerarm_${side}`, [ direction * 0.25, 0, 0 ] );
	const hand = namedBone( `hand_${side}`, [ direction * 0.24, 0, 0 ] );
	parent.add( clavicle );
	clavicle.add( upper );
	upper.add( lower );
	lower.add( hand );

}

function addLeg( parent, side, direction ) {

	const thigh = namedBone( `thigh_${side}`, [ direction * 0.1, - 0.04, 0 ] );
	const calf = namedBone( `calf_${side}`, [ 0, - 0.43, 0 ] );
	const foot = namedBone( `foot_${side}`, [ 0, - 0.43, 0.02 ] );
	const ball = namedBone( `ball_${side}`, [ 0, - 0.08, 0.16 ] );
	parent.add( thigh );
	thigh.add( calf );
	calf.add( foot );
	foot.add( ball );

}

function namedBone( name, position ) {

	const value = new THREE.Bone();
	value.name = name;
	value.position.fromArray( position );
	return value;

}
