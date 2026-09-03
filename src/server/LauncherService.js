import { createLibrary, LibraryError } from '../library/index.js';
import AjvModule from 'ajv/dist/2020.js';
import persistenceValues from '../game/persistence/schema/values.schema.json' with { type: 'json' };
import saveCurrentPayload from '../game/persistence/schema/save-current-payload.schema.json' with { type: 'json' };
import npcState from '../library/schema/npc-state.schema.json' with { type: 'json' };
import npcValues from '../game/agents/schema/values.schema.json' with { type: 'json' };
import continuitySave from '../game/agents/schema/continuity-save.schema.json' with { type: 'json' };
import simulationSave from '../../../simulation/src/schemas/simulation-save.schema.json' with { type: 'json' };
import questValues from '../game/quests/schema/values.schema.json' with { type: 'json' };
import questTransit from '../game/quests/schema/transit-state.schema.json' with { type: 'json' };

const Ajv2020 = AjvModule.default ?? AjvModule;

/** Node-side adapter between the browser launcher contract and the artifact library. */
export class LauncherService {

	constructor( { outDir, creation = null, library = null } ) {

		this.library = library ?? createLibrary( { outDir } );
		this.creation = creation;
		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of [
			npcValues, continuitySave, simulationSave, npcState, questValues, questTransit, persistenceValues
		] ) ajv.addSchema( schema );
		this.validateSaveCurrent = ajv.compile( saveCurrentPayload );

	}

	async catalog() {

		return presentCatalog( await this.library.discover() );

	}

	async continueGame( id ) {

		const game = await this.library.loadGame( { id } );
		return { playUrl: `/?mode=game&game=${encodeURIComponent( game.id )}&out=${encodeURIComponent( `/out/games/${game.id}` )}` };

	}

	exportGame( id ) {

		return this.library.loadGame( { id } );

	}

	exportCity( id ) {

		return this.library.loadCity( { id } );

	}

	async importGame( game ) {

		let current = null;
		try {

			current = await this.library.loadGame( { id: game?.id } );

		} catch ( error ) {

			if ( ! ( error instanceof LibraryError ) || error.code !== 'E_GAME_NOT_FOUND' ) throw error;

		}

		if ( ! current ) await this.library.saveGame( { game, expectedRevision: null } );
		else if ( JSON.stringify( current ) !== JSON.stringify( game ) ) {

			await this.library.saveGame( { game, expectedRevision: current.save.revision } );

		}
		return this.catalog();

	}

	async generateCity( input ) {

		const city = await this.#creation( 'generateCity', input );
		return { city: presentCity( city ), catalog: await this.catalog() };

	}

	async generateInstances( input ) {

		return { instances: await this.#creation( 'generateInstances', input ) };

	}

	async generateQuests( input ) {

		return { quests: await this.#creation( 'generateQuests', input ) };

	}

	async createGame( input ) {

		const game = await this.#creation( 'createGame', input );
		const city = await this.library.loadCity( { id: game.cityId } );
		return { game: presentGame( game, city ), catalog: await this.catalog() };

	}

	async saveCurrent( input ) {

		if ( ! this.validateSaveCurrent( input ) ) {

			const detail = this.validateSaveCurrent.errors
				.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );
			throw new LauncherServiceError( 'E_INVALID_REQUEST', `saveCurrent request is invalid: ${detail}` );

		}
		const current = await this.library.loadGame( { id: input.gameId } );
		if ( input.expectedRevision !== current.save.revision ) {

			throw new LibraryError( 'E_REVISION_CONFLICT', `game ${current.id} is at revision ${current.save.revision}` );

		}
		const game = {
			...current,
			player: input.player,
			quests: input.quests,
			sideJobs: input.sideJobs,
			currentLocation: input.currentLocation,
			discoveredLocations: input.discoveredLocations,
			...( Object.hasOwn( input, 'transitJourney' )
				? { transitJourney: input.transitJourney }
				: Object.hasOwn( current, 'transitJourney' ) ? { transitJourney: current.transitJourney } : {} ),
			...( Object.hasOwn( input, 'questTransit' )
				? { questTransit: input.questTransit }
				: Object.hasOwn( current, 'questTransit' ) ? { questTransit: current.questTransit } : {} ),
			...( Object.hasOwn( input, 'npcState' )
				? { npcState: input.npcState }
				: Object.hasOwn( current, 'npcState' ) ? { npcState: current.npcState } : {} ),
			...( Object.hasOwn( input, 'investigations' )
				? { investigations: input.investigations }
				: Object.hasOwn( current, 'investigations' ) ? { investigations: current.investigations } : {} ),
			save: {
				...current.save,
				revision: current.save.revision + 1,
				updatedAt: input.updatedAt,
				playTimeSeconds: input.playTimeSeconds
			}
		};
		assertProgressIdentity( current.quests, game.quests, 'quests' );
		assertProgressIdentity( current.sideJobs, game.sideJobs, 'side jobs' );

		return ( await this.library.saveGame( { game, expectedRevision: current.save.revision } ) ).game;

	}

	async #creation( method, input ) {

		if ( ! this.creation || typeof this.creation[ method ] !== 'function' ) {

			throw new LauncherServiceError( 'E_CREATION_UNAVAILABLE', `${method} is not connected`, 503 );

		}
		return this.creation[ method ]( input );

	}

}

function assertProgressIdentity( current, next, label ) {

	const saved = new Map( current.map( ( progress ) => [ progress.id, progress ] ) );
	if ( next.length !== current.length || next.some( ( progress ) => ! saved.has( progress.id ) ) ) {

		throw new LauncherServiceError( 'E_INVALID_REQUEST', `saveCurrent cannot add, remove or reclassify ${label}` );

	}
	for ( const progress of next ) {

		const before = saved.get( progress.id );
		if ( progress.title !== before.title || progress.totalSteps !== before.totalSteps ) {

			throw new LauncherServiceError( 'E_INVALID_REQUEST', `saveCurrent cannot change ${progress.id} identity` );

		}

	}

}

export class LauncherServiceError extends Error {

	constructor( code, message, status = 400 ) {

		super( message );
		this.name = 'LauncherServiceError';
		this.code = code;
		this.status = status;

	}

}

export function presentCatalog( catalog ) {

	const cities = new Map( catalog.cities.map( ( city ) => [ city.id, city ] ) );
	return {
		games: [ ...catalog.games ]
			.sort( ( left, right ) => Date.parse( right.save.updatedAt ) - Date.parse( left.save.updatedAt ) || ( left.id < right.id ? - 1 : left.id > right.id ? 1 : 0 ) )
			.map( ( game ) => presentGame( game, cities.get( game.cityId ) ) ),
		cities: catalog.cities.map( presentCity )
	};

}

export function presentCity( city ) {

	return {
		id: city.id,
		name: city.name,
		seed: city.seed,
		size: city.size,
		status: 'ready',
		buildings: city.buildings.length,
		buildingCount: city.buildings.length,
		interiorCount: 0,
		districts: city.districtCount,
		summary: `${city.buildings.length} shells across ${city.districtCount} districts`,
		availableBuildings: city.buildings
	};

}

export function presentGame( game, city ) {

	const active = [ ...game.quests, ...game.sideJobs ].find( ( quest ) => quest.state === 'active' ) ?? null;
	return {
		id: game.id,
		name: game.name,
		cityName: city?.name ?? game.cityId,
		theme: game.theme,
		playable: true,
		mainSteps: game.quests.reduce( ( total, quest ) => total + quest.totalSteps, 0 ),
		sideJobs: game.sideJobs.length,
		interiors: game.selectedInteriors.length,
		location: game.currentLocation.name,
		position: [ game.player.position.x, game.player.position.y, game.player.position.z ],
		activeQuest: active ? { title: active.title, objective: active.objective } : undefined,
		inventory: game.player.inventory.map( ( item ) => ( { name: item.name } ) ),
		locations: game.discoveredLocations.map( ( location ) => ( { name: location.name } ) )
	};

}
