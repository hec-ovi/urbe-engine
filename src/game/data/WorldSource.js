import { readWorldDocument } from './WorldDocument.js';
import { BuildingSource } from './BuildingSource.js';
import { PlanBlueprints } from './PlanBlueprints.js';
import { ReadBudget } from './ReadBudget.js';
import { initialBuildingIds, loadShellCatalog } from './WorldShellCatalog.js';
import { loadWorldConnections } from './WorldConnections.js';
import { questBundle, questBundleFiles, questBundleManifest } from '../../quest-bundle/index.js';
import { worldManifestErrors } from './WorldManifest.js';
import { openNativeStreetSource } from '../ground/native/NativeStreetSource.js';

/** The out dir's own index, written by assemble-city (../assembly/CONTRACT.md). */
const MANIFEST_FILE = 'manifest.json';
const NPC_TYPES_FILE = 'npc-types.json';
const BLUEPRINT_FILE = 'blueprint.json';
const QUESTLINES_FILE = 'quests/questlines.json';
/** The store every world reads its shared resources from (../assembly/SharedResources.js). */
const SHARED_BASE = '/out/shared';
const QUEST_BUNDLE_FILE = 'quests/quest-bundle.json';
const INVESTIGATIONS_FILE = 'quests/investigations.json';
const SCENERY_FILE = 'quests/scenery.json';

/** Loads source-bound world documents and manifest-owned building sources. */
export class WorldSource {

	constructor( { blueprintUrl, outBase, gameId = null, sharedBase = SHARED_BASE } ) {

		this.blueprintUrl = blueprintUrl;
		this.outBase = outBase;
		this.gameId = gameId;
		// The piece kit, the street kit and the interior modules are the same
		// bytes for every city, so they stand in one store every world reads.
		this.sharedBase = sharedBase;

	}

	/** Where one manifest reference's files stand: the shared store, or this world. */
	#baseOf( reference ) {

		return reference.shared ? `${this.sharedBase}/${reference.shared}` : this.outBase;

	}

	async #json( url ) {

		return ( await this.#document( url ) ).data;

	}

	#document( url, reference = {} ) {

		return readWorldDocument( url, reference );

	}

	async #optionalJson( url, fallback ) {

		const response = await fetch( url );
		if ( response.status === 404 ) return fallback;
		const type = ( response.headers?.get( 'content-type' ) ?? '' ).split( ';', 1 )[ 0 ].toLowerCase();
		if ( ! response.ok ) throw new Error( `${url}: HTTP ${response.status}` );
		// Vite sends its HTML application shell with 200 for a missing file.
		// Optional world documents treat that exact development response as absent.
		if ( type === 'text/html' ) return fallback;
		if ( type && type !== 'application/json' ) throw new Error( `${url}: expected JSON, received ${type}` );
		try {

			return await response.json();

		} catch ( error ) {

			throw new Error( `${url}: invalid JSON (${error.message})` );

		}

	}

	/** @returns generated world, complete validated quest catalogs and optional catalog game */
	async load() {

		// Refuse a missing catalog descriptor before starting connections or
		// loading hundreds of building files.
		const game = this.gameId ? await this.#json( `${this.outBase}/game.json` ) : null;
		const manifest = await this.#manifest();
		const blueprint = await this.#document(
			`${this.outBase}/${manifest.blueprint?.file ?? BLUEPRINT_FILE}`,
			{ ...manifest.blueprint, projection: manifest.connections ? blueprintProjection : undefined }
		).catch( ( error ) => {

			if ( manifest.blueprint || Object.hasOwn( manifest, 'connections' ) || Object.hasOwn( manifest, 'streets' ) ) throw error;
			return this.#document( this.blueprintUrl );

		} );
		const atlas = blueprint.data;
		this.#assertBlueprint( manifest, atlas );
		// Everything the manifest names beside the blueprint is a separate file
		// that waits on none of the others, so they are read together: a 1 km
		// city carries tens of megabytes between them.
		const [ connections, nativeStreets, shellCatalog, kit, interiorModules, interiorProps, npcTypes, quests ] = await Promise.all( [
			loadWorldConnections( blueprint, manifest.connections, ( file, reference ) => this.#document( `${this.outBase}/${file}`, reference ) ),
			manifest.streets ? openNativeStreetSource( {
				baseUrl: this.outBase, sharedBase: this.sharedBase, reference: manifest.streets, blueprint
			} ) : null,
			loadShellCatalog( manifest, ( file, reference ) => this.#document( `${this.outBase}/${file}`, reference ) ),
			this.#kit( manifest ),
			this.#resource( manifest.interiorModules ),
			this.#resource( manifest.interiorProps ),
			// The naming box's typed set for this world, when the out dir carries one.
			this.#json( `${this.outBase}/${NPC_TYPES_FILE}` ).catch( () => null ),
			this.#quests( game )
		] );

		const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
		const listedSet = new Set( manifest.parcels );
		// One budget and one plan blueprint per city: the parcels and the kit
		// runtime read the same documents, so they read them through the same
		// depth of requests and never twice.
		const budget = new ReadBudget();
		const readJson = ( url ) => this.#json( url );
		const plans = new PlanBlueprints( { urls: kit?.planUrls ?? new Map(), readJson, budget } );
		const sources = new BuildingSource( { manifest, outBase: this.outBase, plans, readJson, budget } );
		const loadBuildings = ids => sources.load( ids );
		const buildings = await loadBuildings( initialBuildingIds( shellCatalog, manifest, game ) );

		return {
			atlas,
			connections,
			nativeStreets,
			rooftopSpans: manifest.rooftopSpans ?? emptyRooftopSpans( atlas.meta.seed ),
			buildings,
			shellCatalog,
			kit: kit && { document: kit.document, baseUrl: kit.baseUrl, blueprints: plans },
			interiorModules,
			interiorProps,
			loadBuildings,
			// Catalog games carry the player and quest runtime beside their world.
			// Direct city previews have no descriptor and retain session-only play.
			game,
			npcTypes,
			...quests,
			unbuilt: [ ...known ].filter( ( id ) => ! listedSet.has( id ) )
		};

	}

	/**
	 * The distinct buildings this world stands on. The index names each plan's
	 * shell and blueprint relative to the shared store, where every city built
	 * from the same Exterior reads the same copy.
	 * @returns { document, baseUrl, planUrls } or null for a world of generated shells
	 */
	async #kit( manifest ) {

		if ( ! manifest.kit ) return null;

		const base = this.#baseOf( manifest.kit );
		const { data } = await this.#document( `${base}/${manifest.kit.file}`, manifest.kit );

		return {
			document: data,
			baseUrl: this.sharedBase,
			planUrls: new Map( data.plans.map( ( plan ) => [ plan.id, `${this.sharedBase}/${plan.blueprint}` ] ) )
		};

	}

	/**
	 * One city resource catalog the manifest binds by hash, beside the world or
	 * in the shared store: the shared interior modules, the shared furniture.
	 * @returns { document, baseUrl } or null when the world publishes none
	 */
	async #resource( reference ) {

		if ( ! reference ) return null;

		const { file } = reference;
		const base = this.#baseOf( reference );
		const { data } = await this.#document( `${base}/${file}`, reference );

		return { document: data, baseUrl: `${base}/${file.slice( 0, file.lastIndexOf( '/' ) + 1 )}`.replace( /\/+$/, '' ) };

	}

	/** Loads a v1.1 or v1.2 bundle atomically, with a legacy questline fallback for older worlds. */
	async #quests( game ) {

		if ( game?.questBundle === null ) return {
			questBundle: null, questlines: [], objectives: [], investigations: [],
			mechanicTargetBindings: [], missionAssetRequests: [], missionItemBindings: [], scenery: [],
			hostCapabilities: { transportationModes: [] }
		};

		const reference = game?.questBundle?.uri ?? null;
		const manifestUri = reference?.endsWith( '/quest-bundle.json' ) || reference === 'quest-bundle.json'
			? reference
			: reference ? null : QUEST_BUNDLE_FILE;
		const manifest = manifestUri
			? ( reference ? await this.#json( `${this.outBase}/${manifestUri}` ) : await this.#optionalJson( `${this.outBase}/${manifestUri}`, null ) )
			: null;

		if ( manifest ) {

			const checked = questBundleManifest( manifest );
			const slash = manifestUri.lastIndexOf( '/' );
			const directory = slash < 0 ? '' : manifestUri.slice( 0, slash + 1 );
			const catalogs = Object.fromEntries( await Promise.all( questBundleFiles( checked ).map( async ( name ) => [
				name, await this.#json( `${this.outBase}/${directory}${checked.files[ name ]}` )
			] ) ) );
			const complete = questBundle( checked, catalogs );
			return { questBundle: complete, ...catalogs, scenery: complete.scenery };

		}

		const questlinesUri = reference ?? QUESTLINES_FILE;
		return {
			questBundle: null,
			questlines: await this.#optionalJson( `${this.outBase}/${questlinesUri}`, [] ),
			objectives: [],
			investigations: await this.#optionalJson( `${this.outBase}/${INVESTIGATIONS_FILE}`, [] ),
			mechanicTargetBindings: [],
			missionAssetRequests: [],
			missionItemBindings: [],
			scenery: await this.#optionalJson( `${this.outBase}/${SCENERY_FILE}`, [] ),
			hostCapabilities: { transportationModes: [] }
		};

	}

	/** The out dir's validated index. */
	async #manifest() {

		let manifest;

		try {

			manifest = await this.#json( `${this.outBase}/${MANIFEST_FILE}` );

		} catch {

			throw new Error( `${this.outBase} has no ${MANIFEST_FILE}: run assemble-city for this world first` );

		}

		const errors = worldManifestErrors( manifest );
		if ( errors.length ) throw new Error( `${this.outBase} has an invalid ${MANIFEST_FILE}: ${errors.join( '; ' )}; re-run assemble-city` );
		return manifest;

	}

	#assertBlueprint( manifest, atlas ) {

		if ( manifest.seed !== atlas.meta.seed || manifest.atlasVersion !== atlas.meta.version ) {

			throw new Error(
				`${this.outBase} was assembled from ${manifest.seed} at atlas ${manifest.atlasVersion}, `
				+ `this world is ${atlas.meta.seed} at atlas ${atlas.meta.version}: re-run assemble-city`
			);

		}

		const known = new Set( atlas.parcels.map( ( parcel ) => parcel.id ) );
		for ( const id of manifest.parcels ) if ( ! known.has( id ) ) throw new Error( `parcel ${id} is not in the blueprint; re-run assemble-city` );

	}

}

function emptyRooftopSpans( seed ) {

	return {
		meta: { seed: `${seed}:rooftop-spans`, schemaVersion: '1.0.0', generatorVersion: 'legacy' },
		spans: []
	};

}

/** Construction proofs stay in their archive; older blueprints may omit them. */
function blueprintProjection( { root } ) {

	return Object.hasOwn( root?.streets?.construction ?? {}, 'planningReservations' )
		? { omit: [ '/streets/construction/planningReservations' ] }
		: null;

}
