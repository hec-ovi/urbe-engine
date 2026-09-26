import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sharedRoot } from '../../assembly/SharedResources.js';
import { missionMaterialCatalog } from '../../building/MaterialResolver.js';
import { doorFrames } from '../../game/city/DoorGeometry.js';
import { BuildingSource } from '../../game/data/BuildingSource.js';
import { PlanBlueprints } from '../../game/data/PlanBlueprints.js';
import { ReadBudget } from '../../game/data/ReadBudget.js';
import { ScenePlaceResolver } from '../../game/scenery/ScenePlaceResolver.js';
import { SceneryBoundary } from '../../game/scenery/SceneryBoundary.js';
import { SceneryCompiler } from '../../game/scenery/SceneryCompiler.js';
import { MissionAssetRegistry } from '../../mission-assets/src/index.js';

/**
 * Stands every scene of a quest bundle in the world it ships with, before a
 * game is made of it: each place resolves against the opened buildings, the
 * main entrances and the Atlas plan, and each scene compiles its people,
 * mission assets and decals in that frame, exactly as the game's scenery
 * director does with the same seeds. A scene that cannot stand here cannot
 * stand in the game, where its investigation could never be finished.
 *
 * Street fixtures (lamps, street features, dressing) are placed by the game
 * at load, so a street scene is checked against its pavement and plan here
 * and against them at play.
 */
export class SceneryPreflight {

	/**
	 * @param themesDir the Materials themes directory
	 * @param theme the Materials theme the game wears
	 */
	constructor( { themesDir, theme } ) {

		this.themesDir = themesDir;
		this.theme = theme;

	}

	/**
	 * @param worldDir an assembled world with its opened interiors
	 * @param bundle a validated quest bundle
	 * @returns Map of questId to the reason the first of its scenes cannot stand
	 */
	async check( worldDir, bundle ) {

		const blocked = new Map();
		if ( ! bundle.scenery.length ) return blocked;

		const boundary = new SceneryBoundary();
		boundary.input( 'scene-specs', bundle.scenery );
		const read = ( path ) => readJson( path );
		const manifest = await read( join( worldDir, 'manifest.json' ) );
		const atlas = await read( join( worldDir, manifest.blueprint?.file ?? 'blueprint.json' ) );
		const standing = new Set( manifest.parcels );
		const parcels = [ ...new Set( bundle.scenery.map( ( spec ) => spec.place.parcelId ).filter( ( id ) => standing.has( id ) ) ) ];
		const buildings = await this.#buildings( worldDir, manifest, parcels );
		const doors = [ ...buildings.values() ].flatMap( ( building ) => doorFrames( building.blueprint ) )
			.filter( ( door ) => door.role === 'main' );
		const resolver = new ScenePlaceResolver( { buildings, doors, atlas } );
		const compiler = new SceneryCompiler( { boundary, missionAssets: await this.#assets( bundle ), theme: this.theme } );

		for ( const spec of bundle.scenery ) {

			if ( blocked.has( spec.questId ) ) continue;
			try {

				compiler.compile( spec, resolver.resolve( spec.place, spec.seed ), stand( spec ) );

			} catch ( error ) {

				blocked.set( spec.questId, `scene ${spec.sceneId} in ${spec.place.parcelId ?? spec.place.districtId}: ${error.code ?? 'ERROR'} ${error.message}` );

			}

		}
		return blocked;

	}

	/** The scene parcels' building sources, as the game's world source reads them. */
	async #buildings( worldDir, manifest, ids ) {

		const shared = sharedRoot();
		const budget = new ReadBudget();
		const kit = manifest.kit
			? await readJson( join( manifest.kit.shared ? join( shared, manifest.kit.shared ) : worldDir, manifest.kit.file ) )
			: null;
		const plans = new PlanBlueprints( {
			urls: new Map( ( kit?.plans ?? [] ).map( ( plan ) => [ plan.id, join( shared, plan.blueprint ) ] ) ),
			readJson, budget
		} );
		return new BuildingSource( { manifest, outBase: worldDir, plans, readJson, budget } ).load( ids );

	}

	/** The mission assets the scenes show, built from the bundle's requests in the game's material catalog. */
	async #assets( bundle ) {

		const shown = new Set( bundle.scenery.flatMap( ( spec ) => spec.props.map( ( prop ) => prop.assetId ).filter( Boolean ) ) );
		const assemblies = new Map();
		if ( ! shown.size ) return { get: () => null };

		const index = await readJson( join( this.themesDir, this.theme, 'theme.json' ) );
		const registry = new MissionAssetRegistry( missionMaterialCatalog( index.entries ) );
		for ( const request of bundle.missionAssetRequests ) {

			if ( shown.has( request.assetId ) ) assemblies.set( request.assetId, registry.create( request ) );

		}
		return { get: ( assetId ) => assemblies.get( assetId ) ?? null };

	}

}

/**
 * The people of one scene. A quest character stands as whoever the game casts,
 * and a pose measures the same for either body, so any look stands for them.
 */
function stand( spec ) {

	return spec.actors.map( ( actor ) => actor.identity.kind === 'anonymous'
		? { actorId: actor.actorId, gender: actor.identity.gender, appearanceSeed: actor.identity.appearanceSeed }
		: { actorId: actor.actorId, gender: 'female', appearanceSeed: 0 } );

}

async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}
