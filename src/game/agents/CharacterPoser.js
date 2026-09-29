import * as THREE from 'three/webgpu';
import { ImageBitmapLoader, MeshStandardNodeMaterial } from 'three/webgpu';
import { uniform } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTER_MODELS, CHARACTER_ROOT, assertRigCompatibility } from './CharacterCatalog.js';
import { appearance } from './Appearance.js';
import { presenceMaterial } from './Presence.js';
import { CROWD_SURFACE } from './CrowdMesh.js';
import { CharacterAnimations } from './CharacterAnimations.js';
import { bodyOf } from './avatar/BodyShape.js';
import { createPanelMaterial, panelsFor } from './avatar/GarmentPanels.js';
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
const WHITE = new THREE.Color( 1, 1, 1 );
/** The pack's maps the dressed surfaces never read: they are not even decoded. */
const UNREAD_MAPS = /(normal|roughness)(_png)?\.png$/i;

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
 * standing at their height (HeightRig). Everybody wears one wardrobe of
 * materials, a skin per body map, a tint per hair and eye map and panels per
 * garment, sewn the first time anybody needs one: their colours and coverage
 * are uniforms each draw reads off the person being drawn, so dressing a
 * person, however many stand at once, builds no material and links no
 * program another person already did. The pack's maps are read once each,
 * whichever body or hairstyle names them.
 */
export class CharacterPoser {

	/**
	 * @param textureSize the side the pack's maps are downscaled to, the tier's texture size
	 * @param loadModel reads a body `{ scene }` from its catalog entry (CharacterCatalog.CHARACTER_MODELS)
	 * @param loadHair reads a hairstyle `{ scene }` from its path
	 * @param tailor fits people to their bodies (avatar/Tailor.js)
	 */
	constructor( { animation, textureSize = TEXTURE_SIZE, loadModel = null, loadHair = null, tailor = new Tailor() } ) {

		const maps = new Map();
		this.animation = animation;
		this.loadModel = loadModel ?? ( ( descriptor ) => loadGltf( `${CHARACTER_ROOT}/${descriptor.file}`, textureSize, maps ) );
		this.loadHair = loadHair ?? ( ( path ) => loadGltf( `${CHARACTER_ROOT}/${path}`, textureSize, maps ) );
		this.tailor = tailor;
		/** The materials everybody wears (`dress`). */
		this.wardrobe = new Wardrobe();
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
		this.wardrobe.dress( root, source, body );
		// A person of their frame's own height stands on the rig as authored.
		const height = source.recipe.shape.height === 1 ? null : new HeightRig( root, source.recipe.shape.height );
		this.worn.set( root, { fit: source.fit, height } );
		root.position.copy( person.position );
		root.rotation.y = person.heading;
		return root;

	}

	/**
	 * Every garment of the catalog on a dressed root, over its first garment's
	 * shell, in the wardrobe's materials: what a warm-up builds the programs
	 * of. `remove()` takes them off again.
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
			const mesh = new THREE.SkinnedMesh( shell, this.wardrobe.garment( id ) );
			WORN.set( mesh, dressed );
			mesh.name = `sample-${id}`;
			mesh.bind( body.skeleton, body.bindMatrix );
			// Cast and received shadows are part of a program: a sample wears a garment's own.
			mesh.frustumCulled = false;
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			body.parent.add( mesh );
			samples.push( mesh );

		}
		return { meshes: samples, remove: () => samples.forEach( ( mesh ) => mesh.removeFromParent() ) };

	}

	/** Writes a recipe's colours into what a root's person wears. */
	wear( root, recipe ) {

		const dressed = root.userData.dressed;
		if ( dressed && recipe ) wear( dressed, recipe );

	}

	/** Who a mesh is dressed as: its root's `userData.dressed`, which the wardrobe's uniforms read per draw, or null. */
	wears( mesh ) {

		return WORN.get( mesh ) ?? null;

	}

	/** The height rig a dressed root stands on, which lengthens each pose its mixer leaves (HeightRig); null at the frame's own height. */
	height( root ) {

		return this.worn.get( root )?.height ?? null;

	}

	/** The fit a dressed root wears: its body, face and garment geometry (Tailor). */
	fit( root ) {

		return this.worn.get( root )?.fit ?? null;

	}

	/** Undresses a root and hands its fit back to the tailor. */
	release( root ) {

		root.traverse( ( node ) => WORN.delete( node ) );
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

async function loadGltf( url, textureSize, maps ) {

	const loader = new GLTFLoader().register( ( parser ) => new ResizedTextures( parser, textureSize, maps ) );
	return loader.loadAsync( url );

}

/**
 * The pack's maps downscaled on the way in, the way the crowd's are: a 4K map
 * per channel is what kept a shape from staying resident. Every body and
 * hairstyle folder ships its own copy of the same hair and eye maps, so a map
 * is read once by its file name, and the normal and roughness maps the
 * dressed surfaces do not read are not read at all.
 */
class ResizedTextures {

	constructor( parser, size, maps ) {

		this.parser = parser;
		this.maps = maps;
		this.name = 'urbe_resized_textures';
		this.loader = new ImageBitmapLoader( parser.options.manager )
			.setOptions( { premultiplyAlpha: 'none', resizeWidth: size, resizeHeight: size, resizeQuality: 'high' } );
		this.loader.setCrossOrigin( parser.options.crossOrigin );

	}

	loadTexture( textureIndex ) {

		const { source } = this.parser.json.textures[ textureIndex ];
		if ( source === undefined ) return null;
		const file = this.parser.json.images[ source ]?.uri?.split( '/' ).pop() ?? '';
		if ( UNREAD_MAPS.test( file ) ) return Promise.resolve( null );
		if ( ! file ) return this.parser.loadTextureImage( textureIndex, source, this.loader );
		if ( ! this.maps.has( file ) ) this.maps.set( file, this.parser.loadTextureImage( textureIndex, source, this.loader ) );
		return this.maps.get( file );

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

/** Which dressed person each mesh is: the root's `userData.dressed`, read by the wardrobe's uniforms per draw. */
const WORN = new WeakMap();

/**
 * The materials everybody wears. Each is sewn the first time any person
 * needs it and kept for the run: a skin per body map in the person's skin
 * colour, a tint per hair map for hairstyles and brows, an iris per eye map
 * and a panel material per garment. The colours, the garment panels and the
 * coverage are uniforms read per draw off the mesh being drawn, so the whole
 * person fades as one and nobody's colours reach anybody else.
 */
class Wardrobe {

	constructor() {

		const read = ( pick, fallback ) => ( { object } ) => {

			const dressed = WORN.get( object );
			return dressed ? pick( dressed ) : fallback;

		};
		this.presence = uniform( 1 ).onObjectUpdate( read( ( dressed ) => dressed.presence, 1 ) );
		this.colors = {
			skin: uniform( new THREE.Color() ).onObjectUpdate( read( ( dressed ) => dressed.colors.skin, WHITE ) ),
			hair: uniform( new THREE.Color() ).onObjectUpdate( read( ( dressed ) => dressed.colors.hair, WHITE ) ),
			eyes: uniform( new THREE.Color() ).onObjectUpdate( read( ( dressed ) => dressed.colors.eyes, WHITE ) )
		};
		this.skins = new Map();
		this.hairs = new Map();
		this.eyes = new Map();
		this.garments = new Map();

	}

	/** Dresses a root as its person: every mesh takes its wardrobe material and reads that person per draw. */
	dress( root, source, body ) {

		const skin = Array.isArray( body.material ) ? body.material[ 0 ] : body.material;
		const dressed = { presence: 1, recipe: null, colors: { skin: new THREE.Color(), hair: new THREE.Color(), eyes: new THREE.Color() }, panels: new Map() };
		wear( dressed, source.recipe );
		root.traverse( ( node ) => {

			if ( ! node.isMesh ) return;
			if ( node === body ) node.material = this.skin( skin );
			else if ( node.userData.garment ) node.material = this.garment( node.userData.garment.id );
			else if ( node.userData.hair ) node.material = this.#tint( this.hairs, node.material, ( map ) => hairNode( map, this.colors.hair ), HAIR_ROUGHNESS );
			else if ( node.userData.eyes ) node.material = this.#tint( this.eyes, node.material, ( map ) => eyeNode( map, this.colors.eyes ), EYE_ROUGHNESS );
			else return;
			WORN.set( node, dressed );

		} );
		root.userData.dressed = dressed;

	}

	/** The skin over one body map, sewn once. Like the crowd's it carries no normal or roughness map. */
	skin( source ) {

		const key = source?.map ?? null;
		if ( ! this.skins.has( key ) ) {

			const material = presenceMaterial( new MeshStandardNodeMaterial( { ...CROWD_SURFACE, roughness: SKIN_ROUGHNESS } ), this.presence );
			material.name = 'focused-skin';
			material.colorNode = key ? skinNode( key, this.colors.skin ) : this.colors.skin;
			this.skins.set( key, material );

		}
		return this.skins.get( key );

	}

	/** One garment's panels, sewn once. */
	garment( id ) {

		if ( ! this.garments.has( id ) ) {

			const worn = ( object ) => WORN.get( object )?.panels.get( id );
			this.garments.set( id, presenceMaterial( createPanelMaterial( id, null, 'tech', { worn } ), this.presence ) );

		}
		return this.garments.get( id );

	}

	/** The stand-in for one of the pack's hair or eye materials, by its map, sewn once. */
	#tint( materials, source, colorNode, roughness ) {

		const key = source?.map ?? null;
		if ( ! materials.has( key ) ) {

			const material = presenceMaterial( new MeshStandardNodeMaterial( { ...CROWD_SURFACE, roughness } ), this.presence );
			material.name = `focused-${source?.name || 'tint'}`;
			if ( key ) material.colorNode = colorNode( key );
			materials.set( key, material );

		}
		return materials.get( key );

	}

}

/** Writes a person's recipe into what they are dressed as. */
function wear( dressed, recipe ) {

	dressed.recipe = recipe;
	dressed.colors.skin.set( recipe.colors.skin );
	dressed.colors.hair.set( recipe.colors.hair );
	dressed.colors.eyes.set( recipe.colors.eyes );
	dressed.panels = new Map( SLOTS.filter( ( slot ) => recipe.outfit[ slot ] !== 'none' )
		.map( ( slot ) => [ recipe.outfit[ slot ], panelsFor( recipe.outfit.colors[ slot ], recipe.outfit.fabric ) ] ) );

}
