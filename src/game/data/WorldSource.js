import { runConnections } from '../../assembly/connectionsRunner.js';

/** The out dir's own index, written by assemble-city (../assembly/CONTRACT.md). */
const MANIFEST_FILE = 'manifest.json';

/**
 * Everything the game reads off disk, and nothing else: the atlas blueprint,
 * the connections document generated from it, and per parcel the exterior
 * blueprint, the interior NPC support and the floor documents written by
 * `npm run assemble-city`, each floor carrying the URL of its own GLB.
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

	constructor( { blueprintUrl, outBase } ) {

		this.blueprintUrl = blueprintUrl;
		this.outBase = outBase;

	}

	async #json( url ) {

		const response = await fetch( url );

		if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );

		return response.json();

	}

	/** @returns { atlas, connections, buildings, unbuilt } */
	async load() {

		const atlas = await this.#json( this.blueprintUrl );
		const manifest = await this.#manifest( atlas );
		const connections = await runConnections( atlas, { seed: atlas.meta.seed } );

		const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
		const listed = manifest.parcels.filter( ( id ) => known.has( id ) );

		const buildings = new Map(
			( await Promise.all( listed.map( ( id ) => this.#loadBuilding( id, manifest.floors[ id ] ) ) ) )
				.map( ( building ) => [ building.parcelId, building ] )
		);

		return {
			atlas,
			connections,
			buildings,
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

		if ( ! manifest.floors ) throw new Error( `${this.outBase} lists no floor files: re-run assemble-city` );

		return manifest;

	}

	/** @param tags the parcel's floor file tags, as the manifest lists them */
	async #loadBuilding( parcelId, tags ) {

		const base = `${this.outBase}/${parcelId}`;
		const [ blueprint, npc, floors ] = await Promise.all( [
			this.#json( `${base}/${parcelId}.blueprint.json` ),
			this.#json( `${base}/interior/npc.json` ),
			this.#floors( base, tags )
		] );

		return {
			parcelId,
			blueprint,
			npc,
			floors,
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
