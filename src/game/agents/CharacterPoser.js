import * as THREE from 'three/webgpu';
import { ImageBitmapLoader, MeshStandardNodeMaterial } from 'three/webgpu';
import { renderGroup, uniform } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER_MODELS, CHARACTER_ROOT, assertRigCompatibility } from './CharacterCatalog.js';
import { appearance } from './Appearance.js';
import { presenceMaterial } from './Presence.js';
import { CROWD_SURFACE } from './CrowdMesh.js';
import { CharacterAnimations } from './CharacterAnimations.js';
import { bodyOf } from './avatar/BodyShape.js';
import { createPanelMaterial, updatePanelMaterial } from './avatar/GarmentPanels.js';
import { HeightRig } from './avatar/HeightRig.js';
import { GARMENTS, SLOTS } from './avatar/Recipe.js';
import { Tailor, fitKey } from './avatar/Tailor.js';
import { eyeNode, hairNode, skinNode } from './avatar/Tints.js';

/** The maps' side when the tier names none. */
const TEXTURE_SIZE = 1024;
/** The final frame one step short of the clip's end, where a clamped action rests. */
const FINAL_OFFSET = 1 / 120;
/** How the focused skin and eyes answer light; hair keeps the crowd's, cloth its fabric's. */
const SKIN_ROUGHNESS = 0.86;
const HAIR_ROUGHNESS = 0.96;
const EYE_ROUGHNESS = 0.3;

/**
 * Full-quality Source people in their own recipe: the focused and fallen rigs
 * and the still bodies a staged scene lays out.
 *
 * A body is read once for the run with its maps downscaled to the tier's
 * texture size, its Pro clips transferred onto its bone lengths and its
 * tailoring prepared (Tailor). A hairstyle is read once and kept in the head
 * bone's space. A person is their fit, built when first wanted and kept for
 * the next time: their shaped body with what their clothes cover hidden,
 * their face, and a skinned shell per garment on the body's own skeleton,
 * standing at their height (HeightRig). A dressed root wears one set of its
 * body's dressed materials, sewn the first time a root needs it and worn
 * again by the next, its colours written into uniforms, so dressing a person
 * builds no material that a previous person already built.
 */
export class CharacterPoser {

	/**
	 * @param textureSize the side the pack's maps are downscaled to, the tier's texture size
	 * @param loadModel reads a body `{ scene }` from its catalog entry (CharacterCatalog.CHARACTER_MODELS)
	 * @param loadHair reads a hairstyle `{ scene }` from its path
	 * @param tailor fits people to their bodies (avatar/Tailor.js)
	 */
	constructor( {
		animation, textureSize = TEXTURE_SIZE,
		loadModel = ( descriptor ) => loadGltf( `${CHARACTER_ROOT}/${descriptor.file}`, textureSize ),
		loadHair = ( path ) => loadGltf( `${CHARACTER_ROOT}/${path}`, textureSize ),
		tailor = new Tailor()
	} ) {

		this.animation = animation;
		this.loadModel = loadModel;
		this.loadHair = loadHair;
		this.tailor = tailor;
		/** Body models by catalog id, and hairstyles by path, each read once for the run. */
		this.bodies = new Map();
		this.hairs = new Map();
		/** What a dressed root holds: its fit and its height rig, kept off userData, which copies as JSON. */
		this.worn = new WeakMap();

	}

	/** One body, read, rigged and prepared for tailoring once for the run. */
	body( id ) {

		if ( ! this.bodies.has( id ) ) {

			const descriptor = CHARACTER_MODELS.find( ( entry ) => entry.id === id );
			if ( ! descriptor ) return Promise.reject( new Error( `no character body ${id}` ) );
			this.bodies.set( id, Promise.resolve( this.loadModel( descriptor ) ).then( async ( model ) => {

				assertRigCompatibility( model.scene, this.animation.scene );
				model.descriptor = descriptor;
				await this.tailor.prepare( model );
				model.motions = new CharacterAnimations( model.scene, this.animation.scene );
				model.wardrobe = [];
				model.scene.traverse( ( node ) => {

					if ( ! node.isSkinnedMesh ) return;
					// The glTF's eyebrows wear the person's hair colour, its eyes their eye colour.
					if ( /brow/i.test( node.name ) ) node.userData.hair = true;
					else if ( /eye/i.test( node.name ) ) node.userData.eyes = true;

				} );
				return model;

			} ) );

		}
		return this.bodies.get( id );

	}

	/** One hairstyle, read once for the run: its surfaces in the Head bone's space. */
	hair( path ) {

		if ( ! this.hairs.has( path ) ) {

			this.hairs.set( path, Promise.resolve( this.loadHair( path ) ).then( ( hair ) => {

				assertRigCompatibility( hair.scene, this.animation.scene );
				return { path, parts: headParts( hair.scene ) };

			} ) );

		}
		return this.hairs.get( path );

	}

	/**
	 * Everything a person's recipe is dressed from: their body, hairstyle and
	 * fit. The fit is held until the root dressed from it is released, or
	 * `drop` hands it back undressed.
	 */
	async model( recipe ) {

		const [ body, hair ] = await Promise.all( [ this.body( recipe.body ), recipe.hair ? this.hair( recipe.hair ) : null ] );
		const fit = await this.tailor.fit( body, recipe );
		return { recipe, body, hair, fit, motions: body.motions, key: modelKey( recipe ), descriptor: body.descriptor };

	}

	/** Hands back the fit of a model that was never dressed. */
	drop( source ) {

		this.tailor.release( source?.fit );

	}

	/** A copy of the person standing where they do, in their recipe, at their height. */
	dress( source, person, name ) {

		const root = clone( source.body.scene );
		root.name = name;
		const body = bodyOf( root );
		body.geometry = source.fit.body;
		root.traverse( ( node ) => {

			if ( node.isSkinnedMesh && source.fit.auxiliaries.has( node.name ) ) node.geometry = source.fit.auxiliaries.get( node.name );

		} );
		const head = body.skeleton.bones.find( ( bone ) => bone.name === 'Head' );
		if ( ! head ) throw new Error( 'character rig has no Head bone for its hairstyle' );
		root.userData.hairStyle = source.hair?.path ?? '';
		for ( const part of source.hair?.parts ?? [] ) {

			const mesh = new THREE.Mesh( part.geometry, part.material );
			mesh.name = part.name;
			mesh.userData.hair = true;
			head.add( mesh );

		}
		for ( const garment of source.fit.garments ) {

			const mesh = new THREE.SkinnedMesh( garment.geometry, null );
			mesh.name = `garment-${garment.id}`;
			mesh.userData.garment = { id: garment.id, slot: garment.slot };
			mesh.position.copy( body.position );
			mesh.quaternion.copy( body.quaternion );
			mesh.scale.copy( body.scale );
			mesh.bindMode = body.bindMode;
			mesh.bind( body.skeleton, body.bindMatrix );
			mesh.bindMatrixInverse.copy( body.bindMatrixInverse );
			body.parent.add( mesh );

		}
		root.traverse( ( node ) => {

			if ( ! node.isMesh ) return;
			node.castShadow = true;
			node.receiveShadow = true;
			// A pose reaches past the rest pose's bounds.
			if ( node.isSkinnedMesh ) node.frustumCulled = false;

		} );
		dress( root, source, body );
		wear( root.userData.dressed, source.recipe );
		// A person of their frame's own height stands on the rig as authored.
		const height = source.recipe.shape.height === 1 ? null : new HeightRig( root, source.recipe.shape.height );
		this.worn.set( root, { fit: source.fit, height } );
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		return root;

	}

	/**
	 * Every garment of the catalog on a dressed root, over its first garment's
	 * shell, in its dressed set's materials: what a warm-up builds the
	 * programs of. `remove()` takes them off again.
	 */
	sampleWardrobe( root ) {

		const dressed = root.userData.dressed;
		const body = bodyOf( root );
		const shell = this.fit( root )?.garments[ 0 ]?.geometry;
		const worn = new Set();
		root.traverse( ( node ) => { if ( node.userData.garment ) worn.add( node.userData.garment.id ); } );
		const samples = [];
		if ( dressed && shell ) for ( const slot of SLOTS ) for ( const id of GARMENTS[ slot ] ) {

			if ( worn.has( id ) ) continue;
			const mesh = new THREE.SkinnedMesh( shell, garmentMaterial( dressed, id ) );
			mesh.name = `sample-${id}`;
			mesh.bind( body.skeleton, body.bindMatrix );
			mesh.frustumCulled = false;
			body.parent.add( mesh );
			samples.push( mesh );

		}
		return { meshes: samples, remove: () => samples.forEach( ( mesh ) => mesh.removeFromParent() ) };

	}

	/** Writes a recipe's colours into the dressed set a root wears. */
	wear( root, recipe ) {

		const dressed = root.userData.dressed;
		if ( dressed && recipe ) wear( dressed, recipe );

	}

	/** The height rig a dressed root stands on, which lengthens each pose its mixer leaves (HeightRig); null at the frame's own height. */
	height( root ) {

		return this.worn.get( root )?.height ?? null;

	}

	/** The fit a dressed root wears: its body, face and garment geometry (Tailor). */
	fit( root ) {

		return this.worn.get( root )?.fit ?? null;

	}

	/** Hands the root's dressed set back to its body's wardrobe and its fit back to the tailor. */
	release( root ) {

		if ( root.userData.dressed ) root.userData.dressed.worn = false;
		root.userData.dressed = null;
		const worn = this.worn.get( root );
		if ( ! worn ) return;
		this.worn.delete( root );
		worn.height?.dispose();
		this.tailor.release( worn.fit );

	}

	/**
	 * One person held still in a pose: the recipe their gender, seed and
	 * identity give on the street, posed by the transferred clip at their
	 * height. The root stands at the origin facing +Z.
	 *
	 * @param at how far into the clip the pose is held, 0 its first frame and 1 its final one
	 */
	async still( { gender, appearanceSeed, npcId = null }, clipName, at ) {

		const clip = THREE.AnimationClip.findByName( this.animation.animations, clipName );
		if ( ! clip ) throw new Error( `Pro animation library is missing ${clipName}` );
		const { recipe } = appearance( { gender, appearanceSeed, npcId } );
		const source = await this.model( recipe );
		const root = this.dress( source, { position: new THREE.Vector3(), heading: 0 }, `still-${recipe.body}` );
		const mixer = new THREE.AnimationMixer( root );
		const action = mixer.clipAction( source.motions.clip( clip ) );
		action.setLoop( THREE.LoopOnce, 1 );
		action.clampWhenFinished = true;
		action.play();
		mixer.setTime( at * Math.max( 0, clip.duration - FINAL_OFFSET ) );
		action.paused = true;
		this.height( root )?.afterPose();
		root.updateMatrixWorld( true );
		return root;

	}

}

/** Which built person a recipe is: its fit and its hairstyle; colours and height are worn, not built. */
export function modelKey( recipe ) {

	return `${fitKey( recipe )}|${recipe.hair}`;

}

async function loadGltf( url, textureSize ) {

	const loader = new GLTFLoader().register( ( parser ) => new ResizedTextures( parser, textureSize ) );
	return loader.loadAsync( url );

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

/**
 * The pack's "Rigged to Head Bone" styles only follow Head: their bind pose
 * baked into Head-local geometry, against the hairstyle's own rig, fits any
 * body's head and costs no second skeleton per person. Long dreads keep both
 * of their surfaces.
 */
function headParts( hairRoot ) {

	hairRoot.updateMatrixWorld( true );
	const parts = [];
	hairRoot.traverse( ( hair ) => {

		if ( ! hair.isSkinnedMesh ) return;
		const head = hair.skeleton.getBoneByName( 'Head' );
		if ( ! head ) throw new Error( 'hairstyle rig has no Head bone' );
		const geometry = hair.geometry.clone().applyMatrix4( head.matrixWorld.clone().invert().multiply( hair.matrixWorld ) );
		geometry.deleteAttribute( 'skinIndex' );
		geometry.deleteAttribute( 'skinWeight' );
		parts.push( { name: hair.name, geometry, material: hair.material } );

	} );
	if ( ! parts.length ) throw new Error( 'hairstyle has no skinned surface' );
	return parts;

}

/**
 * Dresses a root in a set of its body's materials that no other root wears,
 * sewing one first when none is free: the skin over the pack's map in the
 * person's colour, the eyes' iris, hair and brows in their hair colour, a
 * panel material per garment, all sharing one render-group presence so the
 * whole person fades as one. Like the crowd's, the skin carries no normal or
 * roughness map.
 */
function dress( root, source, body ) {

	const model = source.body;
	const skin = Array.isArray( body.material ) ? body.material[ 0 ] : body.material;
	const dressed = model.wardrobe.find( ( entry ) => ! entry.worn ) ?? sew( model, skin );
	dressed.worn = true;
	dressed.presence.value = 1;
	root.traverse( ( node ) => {

		if ( ! node.isMesh ) return;
		if ( node === body ) node.material = dressed.skin;
		else if ( node.userData.garment ) node.material = garmentMaterial( dressed, node.userData.garment.id );
		else if ( node.userData.hair ) node.material = tinted( dressed.hairs, node.material, dressed, ( map ) => hairNode( map, dressed.colors.hair ), HAIR_ROUGHNESS );
		else if ( node.userData.eyes ) node.material = tinted( dressed.eyes, node.material, dressed, ( map ) => eyeNode( map, dressed.colors.eyes ), EYE_ROUGHNESS );

	} );
	root.userData.dressed = dressed;

}

function sew( model, source ) {

	const presence = uniform( 1 ).setGroup( renderGroup );
	const colors = { skin: uniform( new THREE.Color() ), hair: uniform( new THREE.Color() ), eyes: uniform( new THREE.Color() ) };
	const skin = presenceMaterial( new MeshStandardNodeMaterial( { ...CROWD_SURFACE, roughness: SKIN_ROUGHNESS } ), presence );
	skin.name = 'focused-skin';
	skin.colorNode = source?.map ? skinNode( source.map, colors.skin ) : colors.skin;
	const dressed = { skin, presence, colors, hairs: new Map(), eyes: new Map(), garments: new Map(), recipe: null, worn: false };
	model.wardrobe.push( dressed );
	return dressed;

}

/** The dressed set's stand-in for one of the pack's maps, sewn once. */
function tinted( materials, source, dressed, colorNode, roughness ) {

	let material = materials.get( source );
	if ( ! material ) {

		material = presenceMaterial( new MeshStandardNodeMaterial( { ...CROWD_SURFACE, roughness } ), dressed.presence );
		material.name = `focused-${source?.name || 'tint'}`;
		if ( source?.map ) material.colorNode = colorNode( source.map );
		materials.set( source, material );

	}
	return material;

}

/** The dressed set's panel material for one garment, sewn the first time it is worn. */
function garmentMaterial( dressed, id ) {

	let material = dressed.garments.get( id );
	if ( ! material ) {

		material = presenceMaterial( createPanelMaterial( id ), dressed.presence );
		dressed.garments.set( id, material );
		if ( dressed.recipe ) wearGarment( material, dressed.recipe, id );

	}
	return material;

}

/** Writes one person's recipe into a dressed set's uniforms. */
function wear( dressed, recipe ) {

	dressed.recipe = recipe;
	dressed.colors.skin.value.set( recipe.colors.skin );
	dressed.colors.hair.value.set( recipe.colors.hair );
	dressed.colors.eyes.value.set( recipe.colors.eyes );
	for ( const [ id, material ] of dressed.garments ) wearGarment( material, recipe, id );

}

function wearGarment( material, recipe, id ) {

	const slot = [ 'top', 'pants', 'footwear' ].find( ( entry ) => recipe.outfit[ entry ] === id );
	if ( slot ) updatePanelMaterial( material, recipe.outfit.colors[ slot ], recipe.outfit.fabric );

}
