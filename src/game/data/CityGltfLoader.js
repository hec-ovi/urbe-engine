import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * One loader for producer geometry: shells, interiors and street pieces may
 * arrive quantized and meshopt-compressed, so every city loader decodes both.
 */
export function cityGltfLoader( manager ) {

	const loader = new GLTFLoader( manager );
	loader.setMeshoptDecoder( MeshoptDecoder );
	return loader;

}
