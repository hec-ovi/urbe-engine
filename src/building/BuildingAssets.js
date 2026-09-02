import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads one assembled building from <out>/<parcel>/ as served by vite:
 * the exterior blueprint (floor table for slicing) and either GLB source:
 * 'shell' (exterior only) or 'interior' (shell completed with interiors).
 */
export class BuildingAssets {

	/** @param out the served out directory holding `<parcel>/`: a world build (`/out/small`) or the single-building root (`/out`) */
	constructor( parcel, out = '/out' ) {

		this.parcel = parcel;
		this.base = `${out}/${parcel}`;

	}

	async loadBlueprint() {

		const response = await fetch( `${this.base}/${this.parcel}.blueprint.json` );
		// The dev server answers a missing file with the app page, so a status check is what names the real problem.
		if ( ! response.ok || ! ( response.headers.get( 'content-type' ) ?? '' ).includes( 'json' ) ) throw new Error( `no building at ${this.base}: ${this.parcel}.blueprint.json is missing` );

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
