import * as THREE from 'three/webgpu';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VatBaker } from './VatBaker.js';
import { BodyMesh } from './BodyMesh.js';
import { EVERYONE, HairMesh, crowdHairstyles } from './HairMesh.js';
import { CharacterAnimations } from './CharacterAnimations.js';
import { garments } from './Garments.js';
import { hasClip, transferredClip } from './LayeredClips.js';
import { BodyShapes } from './avatar/BodyShape.js';
import { BUILD_KEYS } from './avatar/Recipe.js';
import { stepped } from './avatar/Steps.js';
import {
	ANIMATION_URL, CHARACTER_MANIFEST_URL, CHARACTER_ROOT, CROWD_CLIPS, CROWD_MODELS,
	assertRigCompatibility
} from './CharacterCatalog.js';

// Clip order matches CharacterCatalog.CROWD_CLIPS: the seven postures, then
// the idle variety and a seat's sitting down and standing up.
export const CLIP = {
	WALK: 0, IDLE: 1, TALK: 2, SIT: 3, SIT_TALK: 4, RUN: 5, CROUCH: 6,
	LOOK_AROUND: 7, DRINK: 8, INTERACT: 9, SIT_FIDGET: 10, SIT_NOD: 11, SIT_DRINK: 12, SIT_DOWN: 13, STAND_UP: 14
};

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
 * regular male and female body/eye surfaces, posed by the Pro animation
 * library's loops baked into vertex animation textures and dressed by the
 * garment map read off their skeleton (Garments.js, BodyMesh.js), and each
 * gender's every hairstyle with its eyebrows, carried by the baked Head bone
 * (HairMesh.js).
 *
 * The packs live in the machine's model store, not the repo (URBE_MODELS_DIR,
 * served under /models by the dev server). Their own 4K PNGs never load: the
 * glTF texture requests are stubbed out. Body, eye and both hair maps are
 * fetched once and downscaled on the way to the GPU.
 */
export class CharacterAssets {

	/**
	 * Reads and checks the packs, then bakes the crowd's vertex animation and
	 * builds its draws. The bake is seconds of vertex work, so it runs a frame
	 * row at a time under the load's budget and counts its parts as it goes.
	 *
	 * @param capacity maximum simultaneous crowd members
	 * @param storageCapable true on the WebGPU backend (see PoseBuffer)
	 * @param slice the frame budget the bake asks between rows
	 * @param onProgress receives (done, total) over the bake's parts
	 */
	static async load( capacity, storageCapable, { slice = null, onProgress = () => {} } = {} ) {

		const manager = new THREE.LoadingManager();
		manager.setURLModifier( ( url ) => ( url.endsWith( '.png' ) ? BLANK : url ) );
		const loader = new GLTFLoader( manager );

		const [ loaded, manifest ] = await Promise.all( [ Promise.all( [
			new GLTFLoader().loadAsync( ANIMATION_URL ),
			Promise.all( CROWD_MODELS.map( ( m ) => loadResizedTexture( `${CHARACTER_ROOT}/${m.skin}`, 1024 ) ) ),
			Promise.all( [ 1, 2 ].map( ( map ) => loadResizedTexture( `${CHARACTER_ROOT}/T_Hair_${map}_BaseColor.png`, 512 ) ) ),
			loadResizedTexture( `${CHARACTER_ROOT}/T_Eye_Brown.png`, 256 ),
			...CROWD_MODELS.map( ( m ) => loader.loadAsync( `${CHARACTER_ROOT}/${m.file}` ) ),
			Promise.all( CROWD_MODELS.map( ( m ) => Promise.all( crowdHairstyles( m.gender ).paths.map( ( path ) => loader.loadAsync( `${CHARACTER_ROOT}/${path}` ) ) ) ) )
		] ), loadCharacterManifest() ] );
		const [ animationGltf, skins, hairMaps, eyeMap ] = loaded;
		const models = loaded.slice( 4, 4 + CROWD_MODELS.length );
		const hairs = loaded[ 4 + CROWD_MODELS.length ];

		for ( const { name } of CROWD_CLIPS ) {

			if ( ! hasClip( animationGltf.animations, name ) ) throw new Error( `animation library is missing ${name}` );

		}

		for ( let i = 0; i < CROWD_MODELS.length; i ++ ) {

			assertRigCompatibility( models[ i ].scene, animationGltf.scene );
			for ( const hair of hairs[ i ] ) assertRigCompatibility( hair.scene, animationGltf.scene );

		}

		// Two bakes per model, the body's two surfaces and the head that
		// carries the hair, are the parts the load counts.
		const total = CROWD_MODELS.length * 2;
		let done = 0;
		const variants = [];

		for ( let i = 0; i < CROWD_MODELS.length; i ++ ) {

			const root = models[ i ].scene;
			const { body, eyes, eyebrows } = characterParts( root );
			// Read off the skeleton before baking: the pose buffers have no
			// bones left to ask.
			const bodyCloth = garments( body );
			// The rest body's extent, which the painted garments are cut against.
			body.geometry.computeBoundingBox();
			const bottom = Math.min( 0, body.geometry.boundingBox.min.y );
			const height = body.geometry.boundingBox.max.y - bottom;
			const motions = new CharacterAnimations( root, animationGltf.scene );
			const bodyClips = [];
			// A transfer is tens of milliseconds: the budget is asked between them.
			for ( const { name } of CROWD_CLIPS ) {

				bodyClips.push( transferredClip( animationGltf.animations, motions, name ) );
				if ( slice ) await slice.step();

			}
			const [ bakedBody, bakedEyes ] = await VatBaker.bake( root, [ body, eyes ], bodyClips, slice, CROWD_CLIPS );
			onProgress( ++ done, total );
			const styles = crowdHairstyles( CROWD_MODELS[ i ].gender );
			const head = await VatBaker.bakeJoint( root, body, 'Head', bodyClips, slice, CROWD_CLIPS );
			const heads = headParts( [
				{ mesh: eyebrows, style: EVERYONE },
				...hairs[ i ].flatMap( ( hair, style ) => skinnedMeshes( hair.scene ).map( ( mesh ) => ( { mesh, style } ) ) )
			] );
			onProgress( ++ done, total );
			const baked = mergeBaked( [ bakedBody, bakedEyes ] );
			// The slim and the broad share the bake: each vertex's builds, out along its normal.
			baked.builds = crowdBuilds( await stepped( BodyShapes.measure( root ), slice ), baked.vertexCount );
			const cloth = crowdCloth( bodyCloth, bakedEyes.vertexCount );

			if ( slice ) await slice.step();
			variants.push( {
				id: CROWD_MODELS[ i ].id,
				body: new BodyMesh( baked, capacity, storageCapable, { map: skins[ i ], eyeMap, cloth, height, bottom } ),
				hair: new HairMesh( { mesh: new THREE.Mesh( heads ), rows: head.rows, head: head.data, clips: head.clips, styles }, capacity, storageCapable, { maps: hairMaps } ),
				bytes: vatBytes( baked, head, storageCapable ),
				durations: bodyClips.map( ( clip ) => clip.duration )
			} );

		}

		return new CharacterAssets(
			variants,
			variants[ 0 ].durations,
			animationGltf,
			animationCatalog( animationGltf, manifest )
		);

	}

	constructor( variants, durations, animation, catalog ) {

		this.variants = variants;
		/** Seconds each baked clip lasts, in CROWD_CLIPS order. */
		this.durations = durations;
		/** Which of them play once rather than loop. */
		this.once = CROWD_CLIPS.map( ( clip ) => Boolean( clip.once ) );
		/** What the pose buffers hold on the GPU, in bytes. */
		this.vatBytes = variants.reduce( ( sum, variant ) => sum + ( variant.bytes ?? 0 ), 0 );
		this.animation = animation;
		this.animationCatalog = catalog;
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

/**
 * The pose buffers of one body on the GPU: its rows of position and normal,
 * a vec4 per vertex (float on WebGPU, half float in WebGL's textures), and the
 * three vec4s a row the head carries its hair on.
 */
export function vatBytes( baked, head, storageCapable ) {

	const scalar = storageCapable ? 4 : 2;
	return ( baked.rows * baked.vertexCount * 2 + head.rows * 3 + ( baked.builds ? baked.vertexCount : 0 ) ) * 4 * scalar;

}

/**
 * Each vertex of the merged body draw, how far one unit of each of a
 * person's builds (Recipe.BUILD_KEYS: upper, waist, lower) moves it out along
 * its rest normal: the body's shape controls (BodyShape) summed over the
 * build's controls and laid on the normal, which holds most of a width
 * control's reach. The eyes, after the body, never move.
 *
 * @param shapes the body's BodyShapes
 * @returns a Float32Array of a vec4 per vertex: upper, waist, lower, 0
 */
export function crowdBuilds( shapes, vertexCount ) {

	const builds = new Float32Array( vertexCount * 4 );
	const normals = shapes.normals;
	const count = normals.length / 3;
	Object.values( BUILD_KEYS ).forEach( ( keys, lane ) => {

		for ( const key of keys ) {

			const basis = shapes.basis[ key ];
			for ( let i = 0; i < count; i ++ ) {

				const x = normals[ i * 3 ], y = normals[ i * 3 + 1 ], z = normals[ i * 3 + 2 ];
				const length = Math.hypot( x, y, z ) || 1;
				builds[ i * 4 + lane ] += ( basis[ i * 3 ] * x + basis[ i * 3 + 1 ] * y + basis[ i * 3 + 2 ] * z ) / length;

			}

		}

	} );
	return builds;

}

async function loadCharacterManifest() {

	const response = await fetch( CHARACTER_MANIFEST_URL );
	if ( ! response.ok ) throw new Error( `character asset manifest returned HTTP ${response.status}` );
	return response.json();

}

/** Exact runtime catalog envelope consumed by the animation coordinator. */
export function animationCatalog( animation, manifest ) {

	const availableClips = animation?.animations?.map( ( clip ) => clip.name ) ?? [];
	if ( manifest?.format !== 'urbe-character-assets' || manifest?.formatVersion !== 2 ) {

		throw new Error( 'character asset manifest format is unsupported' );

	}
	if ( manifest.animations?.edition !== 'Pro' || ! /^[a-f0-9]{64}$/.test( manifest.animations?.sha256 ?? '' ) ) {

		throw new Error( 'character asset manifest does not identify the audited Pro animation source' );

	}
	if ( manifest.animations.clips !== availableClips.length ) {

		throw new Error( 'loaded animation clip count does not match the character asset manifest' );

	}
	const missing = ( manifest.animations.gameClips ?? [] ).filter( ( name ) => ! availableClips.includes( name ) );
	if ( missing.length ) throw new Error( `loaded animation library is missing manifest clips: ${missing.join( ', ' )}` );

	return {
		assetId: 'quaternius-universal-animation-library-pro',
		edition: 'Pro',
		sourceSha256: manifest.animations.sha256,
		availableClips
	};

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

/** Every skinned surface of an export: long dreads have two. */
function skinnedMeshes( root ) {

	const meshes = [];
	root.traverse( ( node ) => { if ( node.isSkinnedMesh ) meshes.push( node ); } );
	if ( ! meshes.length ) throw new Error( 'hairstyle has no skinned surface' );
	return meshes;

}

/**
 * The parts carried by the Head bone, merged into one geometry in that bone's
 * rest space: each part's bind pose read through the Head's inverse bind, its
 * normals turned with it, and each vertex marked with its style and the hair
 * map its material paints from (`hairPart`: style, 0 or 1).
 *
 * @param parts `{ mesh, style }`, a skinned surface all of whose weight is on Head
 */
export function headParts( parts ) {

	const geometries = parts.map( ( { mesh, style } ) => {

		const head = mesh.skeleton.bones.findIndex( ( bone ) => bone.name === 'Head' );
		if ( head < 0 ) throw new Error( `${mesh.name} has no Head bone to ride on` );
		const intoHead = mesh.skeleton.boneInverses[ head ].clone().multiply( mesh.bindMatrix );
		const geometry = new THREE.BufferGeometry();
		const source = mesh.geometry;
		geometry.setAttribute( 'position', source.getAttribute( 'position' ).clone().applyMatrix4( intoHead ) );
		geometry.setAttribute( 'normal', source.getAttribute( 'normal' ).clone().applyNormalMatrix( new THREE.Matrix3().getNormalMatrix( intoHead ) ) );
		geometry.setAttribute( 'uv', source.getAttribute( 'uv' ).clone() );
		const map = /hair_2/i.test( ( Array.isArray( mesh.material ) ? mesh.material[ 0 ] : mesh.material )?.name ?? '' ) ? 1 : 0;
		const count = source.getAttribute( 'position' ).count;
		geometry.setAttribute( 'hairPart', new THREE.BufferAttribute( new Float32Array( count * 2 ).map( ( _, i ) => i % 2 ? map : style ), 2 ) );
		geometry.setIndex( source.index ? source.index.clone() : null );
		return geometry;

	} );
	const merged = BufferGeometryUtils.mergeGeometries( geometries, false );
	geometries.forEach( ( geometry ) => geometry.dispose() );
	if ( ! merged ) throw new Error( 'the hairstyles cannot be merged' );
	return merged;

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
		normal: mergeRows( parts, 'normal', rows, vertexCount ),
		...( parts[ 0 ].clips ? { clips: parts[ 0 ].clips } : {} )
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
