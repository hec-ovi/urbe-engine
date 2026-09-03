import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
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

// Clip order matches CharacterCatalog.CROWD_CLIP_NAMES.
export const CLIP = { WALK: 0, IDLE: 1, TALK: 2, SIT: 3, SIT_TALK: 4, RUN: 5, CROUCH: 6 };

export function clipForNpcAnimation( animation ) {

	return {
		walk: CLIP.WALK,
		run: CLIP.RUN,
		idle: CLIP.IDLE,
		sit: CLIP.SIT,
		crouch: CLIP.CROUCH
	}[ animation ] ?? CLIP.IDLE;

}
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/**
 * The Source Quaternius character kit turned into four crowd draw calls: the
 * regular male and female body/eye and hair/eyebrow surfaces, posed by the Pro
 * animation library's loops baked into vertex animation textures and dressed
 * by the garment map read off their skeleton (Garments.js, BodyMesh.js).
 *
 * The packs live in the machine's model store, not the repo (URBE_MODELS_DIR,
 * served under /models by the dev server). Their own 4K PNGs never load: the
 * glTF texture requests are stubbed out. Body, eye and gender-correct hair maps
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
			Promise.all( CROWD_MODELS.map( ( m ) => loadResizedTexture(
				`${CHARACTER_ROOT}/T_Hair_${m.gender === 'female' ? 2 : 1}_BaseColor.png`, 512
			) ) ),
			loadResizedTexture( `${CHARACTER_ROOT}/T_Eye_Brown.png`, 256 ),
			...CROWD_MODELS.map( ( m ) => loader.loadAsync( `${CHARACTER_ROOT}/${m.file}` ) ),
			...CROWD_MODELS.map( ( m ) => loader.loadAsync( `${CHARACTER_ROOT}/${m.hair}` ) )
		] );
		const [ animationGltf, skins, hairMaps, eyeMap ] = loaded;
		const models = loaded.slice( 4, 4 + CROWD_MODELS.length );
		const hairs = loaded.slice( 4 + CROWD_MODELS.length );

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
			const { body, eyes, eyebrows } = characterParts( root );
			const hair = largestSkinnedMesh( hairRoot );
			// Read off the skeleton before baking: the pose buffers have no
			// bones left to ask.
			const bodyCloth = garments( body );
			const [ bakedBody, bakedEyes, bakedEyebrows ] = VatBaker.bake( root, [ body, eyes, eyebrows ], clips );
			const [ bakedHair ] = VatBaker.bake( hairRoot, [ hair ], clips );
			const baked = mergeBaked( [ bakedBody, bakedEyes ] );
			const bakedHeadHair = mergeBaked( [ bakedHair, bakedEyebrows ] );
			const cloth = crowdCloth( bodyCloth, bakedEyes.vertexCount );

			variants.push( {
				id: CROWD_MODELS[ i ].id,
				body: new BodyMesh( baked, capacity, storageCapable, { map: skins[ i ], eyeMap, cloth } ),
				hair: new HairMesh( bakedHeadHair, capacity, storageCapable, { map: hairMaps[ i ] } )
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

/** The base-character export is three skinned surfaces. None may disappear. */
export function characterParts( root ) {

	let eyes = null;
	let eyebrows = null;
	const bodies = [];

	root.traverse( ( node ) => {

		if ( ! node.isSkinnedMesh ) return;
		const name = node.name.toLowerCase();
		if ( name === 'eyes' ) eyes = node;
		else if ( name === 'eyebrows' ) eyebrows = node;
		else bodies.push( node );

	} );

	const body = largest( bodies );

	if ( ! body || ! eyes || ! eyebrows ) {

		throw new Error( 'character model must contain body, eyes and eyebrows meshes' );

	}

	return { body, eyes, eyebrows };

}

/** The hairstyle export has one skinned surface. */
function largestSkinnedMesh( root ) {

	const meshes = [];

	root.traverse( ( node ) => {

		if ( node.isSkinnedMesh ) meshes.push( node );

	} );

	const mesh = largest( meshes );

	if ( ! mesh ) throw new Error( 'character model has no skinned mesh' );

	return mesh;

}

function largest( meshes ) {

	return meshes.reduce( ( best, mesh ) => {

		const count = mesh.geometry.getAttribute( 'position' )?.count ?? 0;
		const bestCount = best?.geometry.getAttribute( 'position' )?.count ?? - 1;
		return count > bestCount ? mesh : best;

	}, null );

}

/**
 * Concatenate separately textured baked surfaces into one instanced draw.
 * Vertex rows keep the same part order as the merged geometry.
 */
export function mergeBaked( parts ) {

	if ( ! parts.length ) throw new Error( 'cannot merge an empty baked character' );

	const rows = parts[ 0 ].rows;
	const vertexCount = parts.reduce( ( sum, part ) => sum + part.vertexCount, 0 );
	const geometries = parts.map( ( part ) => {

		if ( part.rows !== rows ) throw new Error( 'baked character parts have different row counts' );
		if ( part.mesh.geometry.getAttribute( 'position' )?.count !== part.vertexCount ) {

			throw new Error( 'baked character geometry does not match its vertex count' );

		}

		const geometry = part.mesh.geometry.clone();

		for ( const name of Object.keys( geometry.attributes ) ) {

			if ( name !== 'position' && name !== 'uv' ) geometry.deleteAttribute( name );

		}

		if ( ! geometry.hasAttribute( 'uv' ) ) throw new Error( 'baked character geometry has no primary UVs' );

		return geometry;

	} );
	const geometry = BufferGeometryUtils.mergeGeometries( geometries, false );
	geometries.forEach( ( part ) => part.dispose() );

	if ( ! geometry ) throw new Error( 'baked character geometries cannot be merged' );

	return {
		mesh: new THREE.Mesh( geometry ),
		vertexCount,
		rows,
		position: mergeRows( parts, 'position', rows, vertexCount ),
		normal: mergeRows( parts, 'normal', rows, vertexCount )
	};

}

function mergeRows( parts, channel, rows, vertexCount ) {

	const joined = new Float32Array( rows * vertexCount * 4 );

	for ( let row = 0; row < rows; row ++ ) {

		let vertexOffset = 0;

		for ( const part of parts ) {

			const sourceStart = row * part.vertexCount * 4;
			const targetStart = ( row * vertexCount + vertexOffset ) * 4;
			joined.set( part[ channel ].subarray( sourceStart, sourceStart + part.vertexCount * 4 ), targetStart );
			vertexOffset += part.vertexCount;

		}

	}

	return joined;

}

/** Body garment markers followed by eye markers for the merged body draw. */
export function crowdCloth( bodyCloth, eyeVertices ) {

	if ( bodyCloth.itemSize !== 4 ) throw new Error( 'crowd garment map must be vec4' );

	const values = new Float32Array( ( bodyCloth.count + eyeVertices ) * 4 );
	values.set( bodyCloth.array );

	for ( let i = bodyCloth.count; i < bodyCloth.count + eyeVertices; i ++ ) {

		values.set( [ - 1, 2, 2, 0 ], i * 4 );

	}

	return new THREE.BufferAttribute( values, 4 );

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
