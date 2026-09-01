import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VatBaker } from './VatBaker.js';
import { BodyMesh } from './BodyMesh.js';
import { HairMesh } from './HairMesh.js';
import { garments } from './Garments.js';

const BASE = '/models';
const CHARACTERS = `${BASE}/universal-base-characters/Base Characters/Godot - UE`;
const ANIMATIONS = `${BASE}/universal-animation-library/Unreal-Godot/UAL1_Standard.glb`;

// Clip order is the crowd's clip index: 0 walk, 1 idle, 2 talking.
export const CLIP = { WALK: 0, IDLE: 1, TALK: 2 };
const CLIP_NAMES = [ 'Walk_Loop', 'Idle_Loop', 'Idle_Talking_Loop' ];

const MODELS = [
	{ id: 'male', file: 'Superhero_Male_FullBody.gltf', skin: 'T_Superhero_Male_Dark.png' },
	{ id: 'female', file: 'Superhero_Female_FullBody.gltf', skin: 'T_Superhero_Female_Dark_BaseColor.png' }
];

const HAIR_TEXTURE = 'T_Hair_1_BaseColor.png';
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The CC0 Quaternius character kit turned into crowd draw calls: the two base
 * bodies and their hair, posed by the Universal Animation Library's walk, idle
 * and talking loops baked into vertex animation textures, and dressed by the
 * garment map read off their skeleton (Garments.js, BodyMesh.js).
 *
 * The packs live in the machine's model store, not the repo (URBE_MODELS_DIR,
 * served under /models by the dev server). Their own 4K PNGs never load: the
 * glTF's texture requests are stubbed out and the two maps the crowd actually
 * needs are fetched once and downscaled on the way to the GPU.
 */
export class CharacterAssets {

	/**
	 * @param capacity maximum simultaneous crowd members
	 * @param storageCapable true on the WebGPU backend (see PoseBuffer)
	 */
	static async load( capacity, storageCapable ) {

		const manager = new THREE.LoadingManager();
		manager.setURLModifier( ( url ) => ( url.endsWith( '.png' ) ? BLANK : url ) );
		const loader = new GLTFLoader( manager );

		const [ animationGltf, skins, hairMap, ...models ] = await Promise.all( [
			new GLTFLoader().loadAsync( ANIMATIONS ),
			Promise.all( MODELS.map( ( m ) => loadResizedTexture( `${CHARACTERS}/${m.skin}`, 1024 ) ) ),
			loadResizedTexture( `${CHARACTERS}/${HAIR_TEXTURE}`, 512 ),
			...MODELS.map( ( m ) => loader.loadAsync( `${CHARACTERS}/${m.file}` ) )
		] );

		const clips = CLIP_NAMES.map( ( name ) => {

			const clip = animationGltf.animations.find( ( c ) => c.name === name );

			if ( ! clip ) throw new Error( `animation library is missing ${name}` );

			return clip;

		} );

		const variants = [];

		for ( let i = 0; i < MODELS.length; i ++ ) {

			const root = models[ i ].scene;
			const parts = collect( root );
			// Read off the skeleton before baking: the pose buffers have no
			// bones left to ask.
			const cloth = garments( parts.body );
			const baked = VatBaker.bake( root, [ parts.body, parts.hair ].filter( Boolean ), clips );

			variants.push( {
				id: MODELS[ i ].id,
				body: new BodyMesh( baked[ 0 ], capacity, storageCapable, { map: skins[ i ], cloth } ),
				hair: baked[ 1 ] ? new HairMesh( baked[ 1 ], capacity, storageCapable, { map: hairMap } ) : null
			} );

		}

		return new CharacterAssets( variants, clips.map( ( clip ) => clip.duration ) );

	}

	constructor( variants, durations ) {

		this.variants = variants;
		this.durations = durations;
		this.group = new THREE.Group();
		this.group.name = 'crowd';

		for ( const variant of variants ) {

			this.group.add( variant.body.mesh );
			if ( variant.hair ) this.group.add( variant.hair.mesh );

		}

	}

	/** Every instanced mesh, so the crowd can write and commit them together. */
	meshesOf( variantIndex ) {

		const variant = this.variants[ variantIndex ];

		return variant.hair ? [ variant.body, variant.hair ] : [ variant.body ];

	}

}

/** The base kit ships body, hair and eyes as separate skinned meshes. */
function collect( root ) {

	const parts = { body: null, hair: null };

	root.traverse( ( node ) => {

		if ( ! node.isSkinnedMesh ) return;

		const material = node.material?.name ?? '';

		if ( material.includes( 'Hair' ) ) parts.hair = node;
		else if ( ! material.includes( 'Eyes' ) ) parts.body = node;

	} );

	if ( ! parts.body ) throw new Error( 'character model has no body mesh' );

	return parts;

}

/** One of the pack's 4K maps, downscaled on the way to the GPU. */
async function loadResizedTexture( url, size ) {

	const response = await fetch( url );

	if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );

	const blob = await response.blob();
	const bitmap = await createImageBitmap( blob, {
		resizeWidth: size,
		resizeHeight: size,
		resizeQuality: 'high'
	} );

	const map = new THREE.Texture( bitmap );
	map.colorSpace = THREE.SRGBColorSpace;
	map.flipY = false;
	map.needsUpdate = true;

	return map;

}
