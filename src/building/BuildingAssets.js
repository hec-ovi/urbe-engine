import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const GLB_TYPES = new Set( [ 'model/gltf-binary', 'application/octet-stream' ] );

export class BuildingAssetError extends Error {

	constructor( state, code, message, details ) {

		super( message );
		this.name = 'BuildingAssetError';
		this.state = state;
		this.code = code;
		this.details = details;

	}

}

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

	/** Ensure the selected Atlas parcel has the requested generated source in this world. */
	async ensure( source = 'shell' ) {

		const response = await fetch( '/api/building', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( {
				parcel: this.parcel,
				out: this.base.slice( 0, - ( this.parcel.length + 1 ) ),
				source
			} )
		} );
		const type = mediaType( response );
		const result = type === 'application/json' ? await response.json().catch( () => null ) : null;

		if ( ! response.ok ) {

			const code = result?.code ?? 'E_BUILD_FAILED';
			const message = result?.message ?? `build request returned HTTP ${response.status}`;
			throw new BuildingAssetError(
				'failed', code, message,
				`${code}: ${message}\nPOST /api/building returned ${response.status} ${type || 'without a content type'}`
			);

		}
		if ( ! result ) throw new BuildingAssetError(
			'failed', 'E_BUILD_RESPONSE', 'The preview builder returned an unreadable response.',
			`POST /api/building returned ${response.status} ${type || 'without a content type'}`
		);

		return result;

	}

	async loadBlueprint() {

		const url = `${this.base}/${this.parcel}.blueprint.json`;
		const response = await fetch( url );
		// The dev server answers a missing file with the app page, so a status check is what names the real problem.
		if ( ! response.ok || mediaType( response ) !== 'application/json' ) throw new BuildingAssetError(
			response.status === 404 || mediaType( response ) === 'text/html' ? 'unavailable' : 'failed',
			'E_BLUEPRINT_UNAVAILABLE',
			`${this.parcel} has no readable building blueprint in ${this.base}.`,
			`GET ${url} returned ${response.status} ${mediaType( response ) || 'without a content type'}`
		);

		try {

			return await response.json();

		} catch ( error ) {

			throw new BuildingAssetError(
				'failed', 'E_BLUEPRINT_INVALID', `${this.parcel}'s building blueprint is not valid JSON.`,
				`GET ${url}: ${error.message}`
			);

		}

	}

	/** @returns true when the interior GLB exists for this parcel. */
	async hasInterior() {

		return ( await this.inspectScene( 'interior' ) ).available;

	}

	/**
	 * Checks status and MIME before a loader sees the body. Vite's missing-file
	 * fallback is HTTP 200 HTML, which is unavailable output, not a GLB parse
	 * failure.
	 */
	async inspectScene( source ) {

		const url = this.sceneUrl( source );
		const response = await fetch( url, { method: 'HEAD' } );
		const type = mediaType( response );

		if ( response.ok && GLB_TYPES.has( type ) ) return { available: true, source, url, status: response.status, mediaType: type };

		const missing = response.status === 404 || ( response.ok && type === 'text/html' );

		return {
			available: false,
			state: missing ? 'unavailable' : 'failed',
			code: missing ? 'E_SOURCE_UNAVAILABLE' : 'E_SOURCE_RESPONSE',
			message: missing
				? `${this.parcel} has no generated ${source === 'interior' ? 'interior' : 'exterior'} in ${this.base}.`
				: `${this.parcel}'s ${source === 'interior' ? 'interior' : 'exterior'} could not be read.`,
			details: `HEAD ${url} returned ${response.status} ${type || 'without a content type'}`,
			source, url, status: response.status, mediaType: type
		};

	}

	/** @param source 'shell' | 'interior' @returns the glTF scene (THREE.Group) */
	async loadScene( source, inspected = null ) {

		const status = inspected ?? await this.inspectScene( source );
		if ( ! status.available ) throw new BuildingAssetError( status.state, status.code, status.message, status.details );

		try {

			const gltf = await new GLTFLoader().loadAsync( status.url );

			return gltf.scene;

		} catch ( error ) {

			throw new BuildingAssetError(
				'failed', 'E_SOURCE_LOAD', `${this.parcel}'s ${source} GLB could not be loaded.`,
				`GET ${status.url}: ${error.message}`
			);

		}

	}

	sceneUrl( source ) {

		return source === 'interior'
			? `${this.base}/interior/building.glb`
			: `${this.base}/${this.parcel}.glb`;

	}

}

function mediaType( response ) {

	return ( response.headers?.get( 'content-type' ) ?? '' ).split( ';', 1 )[ 0 ].trim().toLowerCase();

}
