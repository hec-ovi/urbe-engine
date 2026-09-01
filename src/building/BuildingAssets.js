import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads one assembled building from /out/<parcel>/ as served by vite:
 * the exterior blueprint (floor table for slicing) and either GLB source:
 * 'shell' (exterior only) or 'interior' (shell completed with interiors).
 */
export class BuildingAssets {

	constructor( parcel ) {

		this.parcel = parcel;
		this.base = `/out/${parcel}`;

	}

	async loadBlueprint() {

		const response = await fetch( `${this.base}/${this.parcel}.blueprint.json` );

		if ( ! response.ok ) throw new Error( `blueprint for ${this.parcel}: HTTP ${response.status}` );

		return response.json();

	}

	/** @returns true when the interior GLB exists for this parcel. */
	async hasInterior() {

		const response = await fetch( `${this.base}/interior/building.glb`, { method: 'HEAD' } );

		return response.ok;

	}

	/** @param source 'shell' | 'interior' @returns the glTF scene (THREE.Group) */
	async loadScene( source ) {

		const url = source === 'interior'
			? `${this.base}/interior/building.glb`
			: `${this.base}/${this.parcel}.glb`;

		const gltf = await new GLTFLoader().loadAsync( url );

		return gltf.scene;

	}

}
