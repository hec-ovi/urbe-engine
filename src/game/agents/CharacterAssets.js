import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VatBaker } from './VatBaker.js';
import { BodyMesh } from './BodyMesh.js';
import { HairMesh } from './HairMesh.js';
import { garments } from './Garments.js';
import {
	ANIMATION_URL, CHARACTER_ROOT, CROWD_CLIP_NAMES, CROWD_MODELS,
	assertRigCompatibility
} from './CharacterCatalog.js';

export { bodyFor } from './CharacterCatalog.js';

// Clip order is the crowd's clip index: 0 walk, 1 idle, 2 talking.
export const CLIP = { WALK: 0, IDLE: 1, TALK: 2, SIT: 3, SIT_TALK: 4 };
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The Source Quaternius character kit turned into four crowd draw calls: the
 * regular male and female bodies and hairstyles, posed by the Pro animation
 * library's walk, idle and talking loops baked into vertex animation textures,
 * and dressed by the garment map read off their skeleton (Garments.js,
 * BodyMesh.js).
 *
 * The packs live in the machine's model store, not the repo (URBE_MODELS_DIR,
 * served under /models by the dev server). Their own 4K PNGs never load: the
 * glTF texture requests are stubbed out and the two body maps the crowd needs
 * are fetched once and downscaled on the way to the GPU.
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

		const loaded = await Promise.all( [
			new GLTFLoader().loadAsync( ANIMATION_URL ),
			Promise.all( CROWD_MODELS.map( ( m ) => loadResizedTexture( `${CHARACTER_ROOT}/${m.skin}`, 1024 ) ) ),
			loadResizedTexture( `${CHARACTER_ROOT}/T_Hair_1_BaseColor.png`, 512 ),
			...CROWD_MODELS.map( ( m ) => loader.loadAsync( `${CHARACTER_ROOT}/${m.file}` ) ),
			...CROWD_MODELS.map( ( m ) => loader.loadAsync( `${CHARACTER_ROOT}/${m.hair}` ) )
		] );
		const [ animationGltf, skins, hairMap ] = loaded;
		const models = loaded.slice( 3, 3 + CROWD_MODELS.length );
		const hairs = loaded.slice( 3 + CROWD_MODELS.length );

		const clips = CROWD_CLIP_NAMES.map( ( name ) => {

			const clip = animationGltf.animations.find( ( c ) => c.name === name );

			if ( ! clip ) throw new Error( `animation library is missing ${name}` );

			return clip;

		} );

		const variants = [];

		for ( let i = 0; i < CROWD_MODELS.length; i ++ ) {

			const root = models[ i ].scene;
			const hairRoot = hairs[ i ].scene;
			assertRigCompatibility( root, animationGltf.scene );
			assertRigCompatibility( hairRoot, animationGltf.scene );
			const body = collectBody( root );
			const hair = collectBody( hairRoot );
			// Read off the skeleton before baking: the pose buffers have no
			// bones left to ask.
			const cloth = garments( body );
			const [ baked ] = VatBaker.bake( root, [ body ], clips );
			const [ bakedHair ] = VatBaker.bake( hairRoot, [ hair ], clips );

			variants.push( {
				id: CROWD_MODELS[ i ].id,
				body: new BodyMesh( baked, capacity, storageCapable, { map: skins[ i ], cloth } ),
				hair: new HairMesh( bakedHair, capacity, storageCapable, { map: hairMap } )
			} );

		}

		return new CharacterAssets( variants, clips.map( ( clip ) => clip.duration ), animationGltf );

	}

	constructor( variants, durations, animation ) {

		this.variants = variants;
		this.durations = durations;
		this.animation = animation;
		this.group = new THREE.Group();
		this.group.name = 'crowd';

		for ( const variant of variants ) {

			this.group.add( variant.body.mesh );
			this.group.add( variant.hair.mesh );

		}

	}

	/** Every instanced mesh, so the crowd can write and commit them together. */
	meshesOf( variantIndex ) {

		const variant = this.variants[ variantIndex ];

		return [ variant.body, variant.hair ];

	}

}

/** The full-body mesh is the largest skinned part; eyes and brows are separate. */
function collectBody( root ) {

	let body = null;
	let vertices = - 1;

	root.traverse( ( node ) => {

		if ( ! node.isSkinnedMesh ) return;
		const count = node.geometry.getAttribute( 'position' )?.count ?? 0;
		if ( count > vertices ) { body = node; vertices = count; }

	} );

	if ( ! body ) throw new Error( 'character model has no body mesh' );

	return body;

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
