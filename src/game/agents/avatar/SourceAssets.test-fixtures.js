import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The machine's model store as the engine container mounts it. */
export const MODELS = process.env.URBE_MODELS_DIR ?? '/work/models';
const CHARACTERS = `${MODELS}/universal-base-characters-source`;
/** Whether the Source pack is here: tests of the real bodies skip without it. */
export const SOURCE_PRESENT = existsSync( `${CHARACTERS}/Regular_Male_FullBody.gltf` );

globalThis.ProgressEvent ??= class ProgressEvent {

	constructor( type, values ) {

		this.type = type;
		Object.assign( this, values );

	}

};

/**
 * One of the pack's glTF files with its real buffers and no images: Node has
 * no image decoder, and geometry, skins and rigs are what is under test.
 */
export async function sourceGltf( path, root = CHARACTERS ) {

	const file = resolve( root, path );
	const data = await readFile( file );
	let json = null;
	let binary = null;
	if ( data.readUInt32LE( 0 ) === 0x46546c67 ) {

		// A GLB: its JSON chunk, and its binary chunk as the buffer without a uri.
		for ( let offset = 12; offset < data.length; ) {

			const length = data.readUInt32LE( offset );
			const type = data.readUInt32LE( offset + 4 );
			const chunk = data.subarray( offset + 8, offset + 8 + length );
			if ( type === 0x4e4f534a ) json = JSON.parse( chunk.toString() );
			if ( type === 0x004e4942 ) binary = chunk;
			offset += 8 + length;

		}

	} else json = JSON.parse( data.toString() );
	for ( const buffer of json.buffers ?? [] ) {

		if ( buffer.uri?.startsWith( 'data:' ) ) continue;
		const bytes = buffer.uri ? await readFile( resolve( dirname( file ), decodeURIComponent( buffer.uri ) ) ) : binary;
		buffer.uri = `data:application/octet-stream;base64,${bytes.toString( 'base64' )}`;

	}
	json.materials = ( json.materials ?? [] ).map( ( material ) => ( { name: material.name } ) );
	delete json.images;
	delete json.textures;
	delete json.samplers;
	return new GLTFLoader().parseAsync( JSON.stringify( json ), '' );

}

/** The Pro animation library, its clips and rig, from the store. */
export function animationLibrary() {

	return sourceGltf( 'universal-animation-library-pro/UAL1.glb', MODELS );

}

/** A CharacterPoser's loaders over the store. */
export const sourceLoaders = {
	loadModel: ( descriptor ) => sourceGltf( descriptor.file ),
	loadHair: ( path ) => sourceGltf( path )
};
