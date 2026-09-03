import { runConnections } from '../../assembly/connectionsRunner.js';
import { worldManifestErrors } from './WorldManifest.js';

/** The out dir's own index, written by assemble-city (../assembly/CONTRACT.md). */
const MANIFEST_FILE = 'manifest.json';
const NPC_TYPES_FILE = 'npc-types.json';
const BLUEPRINT_FILE = 'blueprint.json';
const QUESTLINES_FILE = 'quests/questlines.json';
const INVESTIGATIONS_FILE = 'quests/investigations.json';

/**
 * Everything the game reads off disk, and nothing else: the atlas blueprint,
 * the connections document generated from it, and per parcel the exterior
 * blueprint, every shell, and the selected interior NPC support and floor
 * documents written by `npm run assemble-city`, each floor carrying its GLB URL.
 *
 * Which buildings exist, and which floors each has, is the out dir's
 * manifest, never the directory listing: a blueprint that merges two lots
 * leaves the old parcel's folder behind, and loading it would stand a whole
 * building inside the one that replaced it. The manifest also names the
 * blueprint it was assembled from, so a world built from a different one is
 * refused instead of drawn wrong. A blueprint parcel the batch could not build
 * is reported as unbuilt.
 */
export class WorldSource {

	constructor( { blueprintUrl, outBase, gameId = null } ) {

		this.blueprintUrl = blueprintUrl;
		this.outBase = outBase;
		this.gameId = gameId;

	}

	async #json( url ) {

		const response = await fetch( url );
		const type = ( response.headers?.get( 'content-type' ) ?? '' ).split( ';', 1 )[ 0 ].toLowerCase();

		if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );
		if ( type && type !== 'application/json' ) throw new Error( `${url}: expected JSON, received ${type}` );

		try {

			return await response.json();

		} catch ( error ) {

			throw new Error( `${url}: invalid JSON (${error.message})` );

		}

	}

	async #optionalJson( url, fallback ) {

		const response = await fetch( url );
		if ( response.status === 404 ) return fallback;
		const type = ( response.headers?.get( 'content-type' ) ?? '' ).split( ';', 1 )[ 0 ].toLowerCase();
		if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );
		if ( type && type !== 'application/json' ) throw new Error( `${url}: expected JSON, received ${type}` );
		try {

			return await response.json();

		} catch ( error ) {

			throw new Error( `${url}: invalid JSON (${error.message})` );

		}

	}

	/** @returns { atlas, connections, buildings, unbuilt, npcTypes, questlines, investigations, game } */
	async load() {

		// Refuse a missing catalog descriptor before starting connections or
		// loading hundreds of building files.
		const game = this.gameId ? await this.#json( `${this.outBase}/game.json` ) : null;
		// The world folder carries the blueprint it was assembled from (named or
		// not); the atlas sample is the fallback for a folder built before that.
		const atlas = await this.#json( `${this.outBase}/${BLUEPRINT_FILE}` ).catch( () => this.#json( this.blueprintUrl ) );
		const manifest = await this.#manifest( atlas );
		const connections = await runConnections( atlas, { seed: atlas.meta.seed } );

		const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
		const listed = manifest.parcels;
		const interiors = new Set( manifest.interiors );

		const buildings = new Map(
			( await Promise.all( listed.map( ( id ) => this.#loadBuilding( id, manifest.floors[ id ], interiors.has( id ) ) ) ) )
				.map( ( building ) => [ building.parcelId, building ] )
		);

		return {
			atlas,
			connections,
			buildings,
			// Catalog games carry the player and quest runtime beside their world.
			// Direct city previews have no descriptor and retain session-only play.
			game,
			// The naming box's typed set for this world, when the out dir carries one.
			npcTypes: await this.#json( `${this.outBase}/${NPC_TYPES_FILE}` ).catch( () => null ),
			questlines: await this.#json( `${this.outBase}/${QUESTLINES_FILE}` ).catch( () => [] ),
			investigations: await this.#optionalJson( `${this.outBase}/${INVESTIGATIONS_FILE}`, [] ),
			unbuilt: [ ...known ].filter( ( id ) => ! buildings.has( id ) )
		};

	}

	/** The out dir's index, and proof it was assembled from this blueprint. */
	async #manifest( atlas ) {

		let manifest;

		try {

			manifest = await this.#json( `${this.outBase}/${MANIFEST_FILE}` );

		} catch {

			throw new Error( `${this.outBase} has no ${MANIFEST_FILE}: run assemble-city for this world first` );

		}

		if ( manifest.seed !== atlas.meta.seed || manifest.atlasVersion !== atlas.meta.version ) {

			throw new Error(
				`${this.outBase} was assembled from ${manifest.seed} at atlas ${manifest.atlasVersion}, `
				+ `this world is ${atlas.meta.seed} at atlas ${atlas.meta.version}: re-run assemble-city`
			);

		}

		const errors = worldManifestErrors( manifest, new Set( atlas.parcels.map( ( parcel ) => parcel.id ) ) );
		if ( errors.length ) throw new Error( `${this.outBase} has an invalid ${MANIFEST_FILE}: ${errors.join( '; ' )}; re-run assemble-city` );

		return manifest;

	}

	/** @param tags the parcel's floor file tags, as the manifest lists them */
	async #loadBuilding( parcelId, tags, hasInterior ) {

		const base = `${this.outBase}/${parcelId}`;
		const blueprint = await this.#json( `${base}/${parcelId}.blueprint.json` );
		const [ npc, floors ] = hasInterior
			? await Promise.all( [ this.#json( `${base}/interior/npc.json` ), this.#floors( base, tags ) ] )
			: [ null, [] ];

		return {
			parcelId,
			blueprint,
			npc,
			floors,
			hasInterior,
			// The shell, under a megabyte: the city loads it for every building.
			shellUrl: `${base}/${parcelId}.glb`
		};

	}

	/**
	 * The interior floor documents, which carry the room polygons and the light
	 * fixtures the game lights each room from, each with the URL of the GLB
	 * holding that floor's furnished geometry, which the game streams a floor at
	 * a time.
	 */
	#floors( base, tags ) {

		return Promise.all( tags.map( async ( tag ) => ( {
			...await this.#json( `${base}/interior/floors/${tag}.json` ),
			glbUrl: `${base}/interior/floors/${tag}.glb`
		} ) ) );

	}

}
