import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fnv1a } from '../../assembly/hash.js';
import { cloneWorld } from '../../assembly/WorldClone.js';
import { questParcelIds } from '../../assembly/InteriorSelection.js';
import sceneryCapabilities from '../../game/scenery/capabilities.json' with { type: 'json' };
import { createLibrary, LibraryError } from '../../library/index.js';
import {
	questBundle, questBundleFiles, questBundleManifest, selectQuestBundle
} from '../../quest-bundle/index.js';
import { Boundary } from './Boundary.js';
import { CreationError } from './CreationError.js';
import { CityTemplate } from './CityTemplate.js';
import { checksum, cityDescriptor, gameDescriptor, planDescriptor } from './descriptors.js';
import { SceneryPreflight } from './SceneryPreflight.js';

const SIDE_JOB_LIMIT = 3;
const MAIN_LOCATION_COUNT = 7;
/** How much of a failed command's output its error carries. */
const FAILURE_LINES = 40;
/** The recorded story a template city plays, and the people it was written for. */
const RECORDED = 'creation/samples/urbe-small';
const NPC_TYPES = `${RECORDED}/npc-types.json`;
/** The Materials theme the game and its buildings wear. */
const THEME = 'cyberpunk';
const STAGE_INPUTS = {
	planCity: 'generate-city', buildCity: 'build-city', generateCity: 'generate-city',
	generateInstances: 'generate-instances', generateQuests: 'generate-quests', importStory: 'import-story',
	createGame: 'create-game'
};
/** The parcel kind people live in; a named city's story needs one open. */
const HOME = 'residential';
/**
 * A named city opens a home first, then one building of each kind that hires,
 * round after round, so the story written for it has somewhere to live and a
 * spread of places to meet people.
 */
const SPREAD = [
	HOME, 'commerce', 'restaurant', 'clinic', 'police', 'corpo', 'coffee_shop',
	'offices', 'hotel', 'hospital', 'mall', 'factory', 'military'
];

/**
 * The step kinds the game plays whole, in the Quests catalog order; a story
 * uses no other. Left out: assassination, whose only lethal path is traffic the
 * player does not drive; rescue, access, hacking and sabotage, whose fixed
 * targets creation does not bind; transportation, whose journey needs a transit
 * line the story cannot see.
 */
export const PLAYABLE_MECHANICS = Object.freeze( [
	'goto', 'observe', 'talk', 'listen', 'pickup', 'deliver', 'steal', 'work', 'investigation', 'escort'
] );

/** What the game completes and stands, declared to Quests with every story it ships. */
export const HOST_CAPABILITIES = Object.freeze( { transportationModes: [ 'public-transit' ], scenery: sceneryCapabilities } );

export class WorldCreation {

	/** @param preflight `{ check(worldDir, bundle) }` naming the questlines whose scenes cannot stand */
	constructor( config, { run = runCommand, clock = () => new Date(), library = null, preflight = null } = {} ) {

		this.boundary = new Boundary();
		this.boundary.assert( 'config', config );
		this.engineRoot = resolve( config.engineRoot );
		this.atlasRoot = resolve( config.atlasRoot );
		this.questsRoot = resolve( config.questsRoot );
		this.outDir = resolve( config.outDir );
		this.preflight = preflight ?? new SceneryPreflight( { themesDir: resolve( config.themesDir ), theme: THEME } );
		this.run = run;
		this.clock = clock;
		this.library = library ?? createLibrary( { outDir: this.outDir } );

	}

	/** Checks one stage's input without running it, so a queued stage is refused at once. */
	check( method, input ) {

		if ( ! Object.hasOwn( STAGE_INPUTS, method ) ) throw new CreationError( 'E_INVALID_REQUEST', `${method} is no creation stage` );
		this.boundary.assert( STAGE_INPUTS[ method ], input );
		if ( STAGE_INPUTS[ method ] === 'generate-city' ) CityTemplate.check( input );

	}

	/**
	 * Plans a city with Atlas and keeps the plan in `out/plans/<id>` for an
	 * author to name before `buildCity` builds it.
	 */
	async planCity( input, { progress = null } = {} ) {

		this.boundary.assert( 'generate-city', input );
		const template = new CityTemplate( input );
		const id = safeId( template.input.name, template.input.seed );
		await this.#vacant( id );
		const temporary = await this.#temporary( 'plan-' );
		try {

			const atlas = await this.#atlas( this.#runner( progress ), template, temporary );
			const plan = this.boundary.assert( 'plan-result', await planDescriptor( temporary, id, template, atlas, this.clock() ) );
			await writeJson( join( temporary, 'plan.json' ), plan );
			await publish( join( this.outDir, 'plans', id ), temporary, 'city plan' );
			return plan;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	/**
	 * Builds a planned city, from the plan or from the plan as an author named
	 * it. The world binds the blueprint it was built from, so a named city binds
	 * the named one, which must be its plan with names and nothing else.
	 */
	async buildCity( input, { progress = null } = {} ) {

		this.boundary.assert( 'build-city', input );
		const plan = await this.#plan( input.cityId );
		const planDir = join( this.outDir, 'plans', plan.id );
		if ( await exists( join( this.outDir, 'cities', plan.id ) ) ) throw new CreationError( 'E_EXISTS', `city ${plan.id} already exists`, 409 );
		const bytes = await readFile( join( planDir, 'blueprint.json' ) ).catch( () => null );
		if ( ! bytes || checksum( bytes ) !== plan.blueprint.checksum ) {

			throw new CreationError( 'E_STAGE_MISMATCH', `plan ${plan.id} holds another blueprint than the one it was planned with` );

		}

		// The assembler takes the NPC types found beside the blueprint, so the
		// source folder holds the blueprint alone, or the named one with its people.
		const temporary = await this.#temporary( 'city-' );
		try {

			const theme = input.named ? await this.#named( plan, JSON.parse( bytes ), input.named, temporary ) : null;
			if ( ! input.named ) await writeFile( join( temporary, 'blueprint.json' ), bytes );
			const city = await this.#build( this.#runner( progress ), plan.id, plan, temporary, theme );
			await retirePlan( planDir, join( this.outDir, 'cities', plan.id ) );
			return city;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	/** Plans and builds a template city in one stage, unnamed. */
	async generateCity( input, { progress = null } = {} ) {

		this.boundary.assert( 'generate-city', input );
		const template = new CityTemplate( input );
		const id = safeId( template.input.name, template.input.seed );
		await this.#vacant( id );
		const run = this.#runner( progress );
		const temporary = await this.#temporary( 'city-' );
		try {

			await this.#atlas( run, template, temporary );
			return await this.#build( run, id, template.input, temporary, null );

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	async generateInstances( input, { progress = null } = {} ) {

		const run = this.#runner( progress );
		this.boundary.assert( 'generate-instances', input );
		const city = await this.#city( input.cityId );
		const eligible = new Set( city.buildings.filter( ( building ) => building.eligible ).map( ( building ) => building.id ) );
		const manual = input.mode === 'manual';
		if ( manual && input.count !== input.buildingIds.length ) {

			throw new CreationError( 'E_INVALID_REQUEST', 'manual interior count must match the selected building ids' );

		}
		if ( input.buildingIds.some( ( id ) => ! eligible.has( id ) ) ) {

			throw new CreationError( 'E_INVALID_REQUEST', 'interior selection contains an ineligible building' );

		}
		if ( ! manual && input.count < MAIN_LOCATION_COUNT ) {

			throw new CreationError( 'E_QUEST_LOCATIONS', `the main story needs at least ${MAIN_LOCATION_COUNT} interior locations` );

		}

		const temporary = await this.#temporary( 'instances-' );
		const world = join( temporary, 'world' );
		try {

			// A draft shares every file it does not change with its city, and a game with its draft.
			await cloneWorld( join( this.outDir, 'cities', city.id ), world );
			await rm( join( world, 'city.json' ), { force: true } );
			const cityManifest = await json( join( world, 'manifest.json' ), 'city manifest' );
			const named = cityManifest.named === true;
			// An unnamed city plays the recorded story's people.
			const types = join( world, 'npc-types.json' );
			if ( ! named && ! existsSync( types ) ) await cp( join( this.questsRoot, NPC_TYPES ), types );
			// An automatic pick opens the buildings it names first. Then a named
			// city opens a spread of kinds for the story written against them;
			// an unnamed one opens the places of its recorded story, in story order.
			let priority = [];
			let homes = new Set();
			if ( ! manual && named ) {

				const atlas = await json( join( world, 'blueprint.json' ), 'city blueprint' );
				homes = new Set( atlas.parcels.filter( ( parcel ) => parcel.type === HOME ).map( ( parcel ) => parcel.id ) );
				priority = nextHomeAfter( [ ...new Set( [ ...input.buildingIds, ...venueSpread( atlas, cityManifest.sources ) ] ) ], homes, input.count );

			} else if ( ! manual ) {

				const story = await this.#materialize( run, city, world, join( temporary, 'ranking' ), join( this.questsRoot, RECORDED ) );
				priority = [ ...new Set( [ ...input.buildingIds, ...questParcelIds( story.questlines ) ] ) ];

			}

			// A manual pick is exact. An automatic one hands the assembler the
			// count and lets it open candidates in its order, skipping a building
			// Interior cannot furnish for the next one, so one closed building
			// never closes the stage.
			await run( 'npm', [
				'run', 'assemble-city', '--', '--blueprint', join( world, 'blueprint.json' ), '--out', world,
				'--workers', '1', '--reuse-shells', 'true',
				...( manual ? [ '--interior-parcels', input.buildingIds.join( ',' ) ] : [ '--interiors', String( input.count ) ] ),
				...( priority.length ? [ '--interior-priority', priority.join( ',' ) ] : [] )
			], { cwd: this.engineRoot } );
			const manifest = await json( join( world, 'manifest.json' ), 'interior manifest' );
			if ( manual && ! sameIds( manifest.interiors, input.buildingIds ) ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'interior stage did not publish the exact selected buildings' );

			}
			if ( manifest.interiors.length < MAIN_LOCATION_COUNT ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `city ${city.id} opens ${manifest.interiors.length} interiors, the main story needs ${MAIN_LOCATION_COUNT}` );

			}
			if ( homes.size && ! manifest.interiors.some( ( id ) => homes.has( id ) ) ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `city ${city.id} opened no home for the people its story is written for: name one that opens in buildingIds` );

			}
			// What a story's author records against: the world, its people, the
			// opened interiors and, here, what the game plays and stands.
			await handoffInput( join( world, 'quests' ) );
			await writeJson( join( world, 'draft.json' ), {
				contractVersion: '1.0.0', cityId: city.id, interiorIds: manifest.interiors, questId: null
			} );
			await publish( join( this.outDir, 'drafts', city.id ), world, 'interior stage' );
			const result = { ids: manifest.interiors, count: manifest.interiors.length };
			this.boundary.assert( 'instances-result', result );
			return result;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	/** Plays the recorded story in an unnamed city's opened interiors. */
	async generateQuests( input, { progress = null } = {} ) {

		this.boundary.assert( 'generate-quests', input );
		this.#sideJobs( input.sideJobs );
		if ( input.mainBrief.trim() ) {

			throw new CreationError( 'E_STORY_BRIEF_UNAVAILABLE', 'the engine writes no story: a story written outside it comes in through importStory' );

		}
		const { city, draft, draftDir } = await this.#storyStage( input.cityId );
		if ( ! sameIds( draft.interiorIds, input.interiorIds ) ) {

			throw new CreationError( 'E_STAGE_MISMATCH', 'quest input does not match the current interior stage' );

		}
		if ( ( await json( join( draftDir, 'manifest.json' ), 'draft manifest' ) ).named === true ) {

			throw new CreationError( 'E_STAGE_MISMATCH', `city ${city.id} is named and has its own people: its story comes in through importStory` );

		}
		return this.#story( this.#runner( progress ), city, draft, draftDir, join( this.questsRoot, RECORDED ), input.sideJobs, 'quests' );

	}

	/** Plays a story an author wrote outside the engine, as a Quests recording, in the city's opened interiors. */
	async importStory( input, { progress = null } = {} ) {

		this.boundary.assert( 'import-story', input );
		this.#sideJobs( input.sideJobs );
		const recording = resolve( this.engineRoot, input.recording );
		if ( ! ( await lstat( join( recording, 'recording.json' ) ).catch( () => null ) )?.isFile() ) {

			throw new CreationError( 'E_INVALID_REQUEST', `${input.recording} holds no recording.json` );

		}
		const { city, draft, draftDir } = await this.#storyStage( input.cityId );
		await checkAuthored( recording, input.recording, city.size );
		return this.#story( this.#runner( progress ), city, draft, draftDir, recording, input.sideJobs, 'story' );

	}

	async createGame( input ) {

		this.boundary.assert( 'create-game', input );
		const city = await this.#city( input.cityId );
		const hasQuests = input.questId !== null;
		const needsDraft = hasQuests || input.interiorIds.length > 0;
		const draft = needsDraft ? await this.#draft( input.cityId ) : null;
		if ( draft && ( hasQuests && draft.questId !== input.questId || ! sameIds( draft.interiorIds, input.interiorIds ) ) ) {

			throw new CreationError( 'E_STAGE_MISMATCH', 'game input does not match the current creation stages' );

		}
		const id = await exists( join( this.outDir, 'games', city.id ) )
			? `${city.id.slice( 0, 55 )}-${randomUUID().slice( 0, 8 )}` : city.id;
		const target = join( this.outDir, 'games', id );
		const temporary = await this.#temporary( 'game-' );
		const world = join( temporary, 'world' );
		try {

			await cloneWorld( join( this.outDir, needsDraft ? 'drafts' : 'cities', city.id ), world );
			// A game carries its bundle alone: what its names and story were made
			// from, the unselected definitions and the creation stages stay behind.
			for ( const path of [
				'city.json', 'draft.json', 'naming', 'story', ...( hasQuests ? [] : [ 'quests' ] ),
				'quests/all.questlines.json', 'quests/questlines.meta.json', 'quests/handoff-input.json'
			] ) await rm( join( world, path ), { recursive: true, force: true } );
			const atlas = await json( join( world, 'blueprint.json' ), 'game blueprint' );
			const manifest = await json( join( world, 'manifest.json' ), 'game manifest' );
			if ( ! sameIds( manifest.interiors, input.interiorIds ) ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'game manifest does not match the interior stage' );

			}
			const definitions = hasQuests
				? ( await readQuestBundle( join( world, 'quests' ), 'game quest bundle' ) ).questlines : [];
			const game = await gameDescriptor( world, id, city, atlas, manifest, definitions, this.clock() );
			this.boundary.assert( 'game-result', game );
			await mkdir( join( this.outDir, 'games' ), { recursive: true } );
			await rename( world, target );
			try {

				await this.library.saveGame( { game, expectedRevision: null } );

			} catch ( error ) {

				await rm( target, { recursive: true, force: true } );
				throw error;

			}
			return this.boundary.assert( 'game-result', game );

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	/** Writes the Atlas plan for a template into `dir/blueprint.json`. @returns the plan */
	async #atlas( run, template, dir ) {

		const blueprint = join( dir, 'blueprint.json' );
		await run( 'npm', template.command( blueprint ), { cwd: this.atlasRoot } );
		const atlas = await json( blueprint, 'city plan' );
		// An Atlas that does not know a parameter plans without it; the plan must be the one asked for.
		for ( const [ key, value ] of Object.entries( template.params ) ) {

			if ( ! holds( atlas.meta?.params?.[ key ], value ) ) throw new CreationError( 'E_OUTPUT_INVALID', `Atlas planned without the ${key} asked for` );

		}
		return atlas;

	}

	/**
	 * Puts an author's naming of `plan` in `dir` as the assembler reads it: the
	 * named blueprint's bytes and its NPC types beside it.
	 * @returns the naming theme
	 */
	async #named( plan, atlas, named, dir ) {

		const [ blueprint, types ] = await Promise.all( [ named.blueprint, named.types ].map( ( path ) =>
			readFile( resolve( this.engineRoot, path ) ).catch( ( error ) => {

				throw new CreationError( 'E_INVALID_REQUEST', `${path} cannot be read: ${error.message}` );

			} ) ) );
		const world = parse( blueprint, named.blueprint );
		const theme = world.meta?.naming?.theme;
		if ( typeof theme !== 'string' || ! theme.trim() ) throw new CreationError( 'E_INVALID_REQUEST', `${named.blueprint} records no naming theme` );
		// Naming changes names and records itself; anything else is another city.
		if ( ! isDeepStrictEqual( unnamed( world ), unnamed( atlas ) ) ) {

			throw new CreationError( 'E_STAGE_MISMATCH', `${named.blueprint} is not plan ${plan.id} with names` );

		}
		const people = parse( types, named.types );
		if ( ! Array.isArray( people.types ) || people.types.length === 0 ) throw new CreationError( 'E_INVALID_REQUEST', `${named.types} holds no NPC types` );
		await writeFile( join( dir, 'blueprint.json' ), blueprint );
		await writeFile( join( dir, 'npc-types.json' ), types );
		return theme;

	}

	/**
	 * Builds every shell of the blueprint in `dir` and publishes the city as
	 * `id`. A named city (`theme`) must come out named in it, with its people.
	 */
	async #build( run, id, identity, dir, theme ) {

		const target = join( this.outDir, 'cities', id );
		const world = join( dir, 'world' );
		await run( 'npm', [
			'run', 'assemble-city', '--', '--blueprint', join( dir, 'blueprint.json' ), '--out', world, '--interiors', '0'
		], { cwd: this.engineRoot } );
		const atlas = await json( join( world, 'blueprint.json' ), 'generated city blueprint' );
		const manifest = await json( join( world, 'manifest.json' ), 'generated city manifest' );
		// Every parcel stands, is a shell, or is an empty lot on purpose; none is unaccounted for.
		const sources = manifest.sources ?? {};
		if ( atlas.parcels.some( ( parcel ) => ! [ 'kit', 'shell', 'empty' ].includes( sources[ parcel.id ] ) ) || manifest.interiors.length !== 0 ) {

			throw new CreationError( 'E_OUTPUT_INVALID', 'city stage must account for every parcel and hold no interiors' );

		}
		if ( theme !== null && ( manifest.named !== true || manifest.namingTheme !== theme || ! existsSync( join( world, 'npc-types.json' ) ) ) ) {

			throw new CreationError( 'E_OUTPUT_INVALID', 'city stage did not assemble the named world with its people' );

		}

		await mkdir( join( this.outDir, 'cities' ), { recursive: true } );
		await rename( world, target );
		const city = await cityDescriptor( target, id, identity, atlas, this.clock() );
		try {

			await this.library.saveCity( city );

		} catch ( error ) {

			await rm( target, { recursive: true, force: true } );
			throw error;

		}
		return this.boundary.assert( 'city-result', city );

	}

	#sideJobs( count ) {

		if ( count > SIDE_JOB_LIMIT ) throw new CreationError( 'E_SIDE_JOB_LIMIT', `a game carries at most ${SIDE_JOB_LIMIT} side jobs` );

	}

	async #storyStage( cityId ) {

		const city = await this.#city( cityId );
		const draft = await this.#draft( cityId );
		return { city, draft, draftDir: join( this.outDir, 'drafts', cityId ) };

	}

	/**
	 * Replays a recording against the draft's opened interiors, keeps the
	 * questlines the game can play and stand, and publishes their bundle with
	 * what the story was made from in `story/`.
	 * @param kind names the questId: `quests` for the recorded story, `story` for an imported one
	 */
	async #story( run, city, draft, draftDir, recording, sideJobs, kind ) {

		const temporary = await this.#temporary( 'quests-' );
		try {

			const questsDir = join( temporary, 'quests' );
			const storyDir = join( temporary, 'story' );
			// The assembler skips any building Interior cannot furnish, so the
			// story is replayed against the interiors that opened. Without this a
			// story can name a building the player cannot walk into.
			const all = await this.#materialize( run, city, draftDir, questsDir, recording, draft.interiorIds );
			const [ main, ...sides ] = all.questlines;
			const unplayable = unplayableSteps( all.questlines );
			if ( unplayable.has( main.id ) ) throw new CreationError( 'E_INVALID_REQUEST', `the main story ${unplayable.get( main.id )}` );
			// A scene that cannot stand leaves its investigation unfinishable: a
			// side job with one is left out, and the main story fails here.
			const blocked = await this.#standScenery( draftDir, all );
			if ( blocked.has( main.id ) ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `the main story cannot stand in city ${city.id}: ${blocked.get( main.id )}` );

			}
			const leftOut = sides.filter( ( definition ) => unplayable.has( definition.id ) || blocked.has( definition.id ) );
			const definitions = [ main, ...sides.filter( ( definition ) => ! leftOut.includes( definition ) ).slice( 0, sideJobs ) ];
			const missing = questParcelIds( definitions ).filter( ( id ) => ! draft.interiorIds.includes( id ) );
			if ( missing.length ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `quests need interiors not selected in stage 2: ${missing.join( ', ' )}` );

			}
			const selected = bundleOperation( () => selectQuestBundle(
				all, definitions.map( ( definition ) => definition.id )
			), 'quest bundle selection' );
			await writeQuestBundle( questsDir, selected );
			await keepStory( recording, storyDir, leftOut.map( ( definition ) => ( {
				questId: definition.id, reason: unplayable.get( definition.id ) ?? blocked.get( definition.id )
			} ) ) );
			await publish( join( draftDir, 'quests' ), questsDir, 'quest stage' );
			await publish( join( draftDir, 'story' ), storyDir, 'quest stage' );
			const questId = `${city.id}-${kind}-${definitions.length - 1}`;
			await writeJson( join( draftDir, 'draft.json' ), { ...draft, questId } );
			const result = { id: questId, mainSteps: main.steps.length, sideJobs: definitions.length - 1 };
			this.boundary.assert( 'quests-result', result );
			return result;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	/**
	 * Replays a recording over a world into a bundle in `questsDir`, against
	 * what the game plays and stands.
	 * @param within the parcels the story may use, or nothing for the whole city.
	 * A venue that cannot stand inside the set moves to a compatible parcel that
	 * is in it, so every place the story names is a building the player opens.
	 */
	async #materialize( run, city, world, questsDir, recording, within = null ) {

		await run( 'npm', [
			'run', 'materialize', '--', join( recording, 'recording.json' ), city.size,
			join( world, 'blueprint.json' ), join( world, 'npc-types.json' ), join( questsDir, 'all.questlines.json' ),
			await handoffInput( questsDir ), ...( within ? [ `--parcels=${within.join( ',' )}` ] : [] )
		], { cwd: this.questsRoot } );
		return readQuestBundle( questsDir, 'materialized quest bundle' );

	}

	/** @returns Map of questId to why one of its scenes cannot stand in the draft's world */
	async #standScenery( draftDir, bundle ) {

		try {

			return await this.preflight.check( draftDir, bundle );

		} catch ( error ) {

			throw new CreationError( 'E_OUTPUT_INVALID', `quest scenery cannot be checked: ${error.message}` );

		}

	}

	/** The process runner for one stage call, telling `progress` each line its commands print. */
	#runner( progress ) {

		return ( command, args, options ) => this.run( command, args, progress ? { ...options, progress } : options );

	}

	/** A plan's id is its city's: neither may be taken already. */
	async #vacant( id ) {

		for ( const [ folder, state ] of [ [ 'plans', 'planned' ], [ 'cities', 'built' ] ] ) {

			if ( await exists( join( this.outDir, folder, id ) ) ) throw new CreationError( 'E_EXISTS', `city ${id} is already ${state}`, 409 );

		}

	}

	async #plan( id ) {

		const path = join( this.outDir, 'plans', id, 'plan.json' );
		if ( ! await exists( path ) ) throw new CreationError( 'E_PLAN_NOT_FOUND', `city ${id} has no plan`, 404 );
		return json( path, 'city plan' );

	}

	async #city( id ) {

		try {

			return await this.library.loadCity( { id } );

		} catch ( error ) {

			if ( error instanceof LibraryError && error.code === 'E_CITY_NOT_FOUND' ) {

				throw new CreationError( 'E_CITY_NOT_FOUND', `city ${id} was not found`, 404 );

			}
			throw error;

		}

	}

	async #draft( id ) {

		const path = join( this.outDir, 'drafts', id, 'draft.json' );
		if ( ! await exists( path ) ) throw new CreationError( 'E_DRAFT_NOT_FOUND', `city ${id} has no interior creation stage`, 404 );
		return json( path, 'creation draft' );

	}

	async #temporary( prefix ) {

		const root = join( this.outDir, '.work' );
		await mkdir( root, { recursive: true } );
		return mkdtemp( join( root, prefix ) );

	}

}

/**
 * Puts a finished stage in place of the one before it, keeping the one
 * before until the new one stands.
 */
async function publish( target, source, label ) {

	const backup = join( dirname( target ), `.${basename( target )}.previous` );
	await mkdir( dirname( target ), { recursive: true } );
	await rm( backup, { recursive: true, force: true } );
	const previous = await exists( target );
	if ( previous ) await rename( target, backup );
	try {

		await rename( source, target );
		await rm( backup, { recursive: true, force: true } );

	} catch ( error ) {

		if ( previous && ! await exists( target ) ) await rename( backup, target );
		throw new CreationError( 'E_STORAGE', `cannot publish the ${label}: ${error.message}` );

	}

}

/** Declares what the game plays to Quests beside a bundle it writes. @returns the file */
async function handoffInput( questsDir ) {

	const path = join( questsDir, 'handoff-input.json' );
	await mkdir( questsDir, { recursive: true } );
	await writeJson( path, { hostCapabilities: HOST_CAPABILITIES } );
	return path;

}

/**
 * Every standing building a named city can open, a home first, then one of
 * each kind that hires, round after round.
 * @param sources the city manifest's source of each parcel; an empty lot opens nothing
 */
function venueSpread( atlas, sources ) {

	const rank = ( a, b ) => fnv1a( `${atlas.meta.seed}:spread:${a}` ) - fnv1a( `${atlas.meta.seed}:spread:${b}` ) || a.localeCompare( b );
	const standing = atlas.parcels.filter( ( parcel ) => sources?.[ parcel.id ] !== 'empty' );
	const kinds = SPREAD.map( ( type ) => standing.filter( ( parcel ) => parcel.type === type ).map( ( parcel ) => parcel.id ).sort( rank ) );
	const spread = [];
	for ( let round = 0; kinds.some( ( ids ) => round < ids.length ); round ++ ) {

		for ( const ids of kinds ) if ( round < ids.length ) spread.push( ids[ round ] );

	}
	return spread;

}

/**
 * Moves the second home of an automatic order to right after the count, when
 * the first home is within it: the assembler reaches past the count only for a
 * building Interior cannot furnish, so a first home that cannot be furnished
 * gives its place to the next home before any other building.
 */
function nextHomeAfter( order, homes, count ) {

	const [ first, next ] = order.filter( ( id ) => homes.has( id ) );
	if ( next === undefined || order.indexOf( first ) >= count || order.indexOf( next ) <= count ) return order;
	const rest = order.filter( ( id ) => id !== next );
	return [ ...rest.slice( 0, count ), next, ...rest.slice( count ) ];

}

/**
 * Takes a built plan out of `out/plans`: what an author wrote beside the plan,
 * the Naming outputs and author dir among it, goes into the city as `naming/`.
 */
async function retirePlan( planDir, cityDir ) {

	const naming = join( cityDir, 'naming' );
	try {

		await rename( planDir, naming );
		await Promise.all( [ 'plan.json', 'blueprint.json' ].map( ( name ) => rm( join( naming, name ), { force: true } ) ) );
		if ( ! ( await readdir( naming ) ).length ) await rm( naming, { recursive: true, force: true } );

	} catch ( error ) {

		throw new CreationError( 'E_STORAGE', `city ${basename( cityDir )} stands, but its plan cannot be retired: ${error.message}` );

	}

}

/**
 * Refuses a recording an author run left unfinished or cast for another city
 * size: its `meta.json` must carry the bundle, and the profile its people were
 * cast with must be the size the engine replays it with. A directory without
 * `meta.json` is a bare recording and replays as it is.
 */
async function checkAuthored( dir, label, profile ) {

	const bytes = await readFile( join( dir, 'meta.json' ), 'utf8' ).catch( ( error ) => {

		if ( error.code === 'ENOENT' ) return null;
		throw new CreationError( 'E_INVALID_REQUEST', `${label}/meta.json cannot be read: ${error.message}` );

	} );
	if ( bytes === null ) return;
	const meta = parse( bytes, `${label}/meta.json` );
	if ( ! meta?.bundle ) throw new CreationError( 'E_INVALID_REQUEST', `${label} holds no finished story: its meta.json has no bundle` );
	if ( meta.profile !== profile ) {

		throw new CreationError( 'E_INVALID_REQUEST', `${label} was cast with profile ${meta.profile}, a ${profile} city replays it with profile ${profile}: record it with --profile ${profile}` );

	}

}

/** Whether Atlas's resolved parameter holds the one asked for: the same value, or of an object each field asked for. */
function holds( resolved, asked ) {

	if ( ! asked || typeof asked !== 'object' || Array.isArray( asked ) ) return isDeepStrictEqual( resolved, asked );
	return Object.entries( asked ).every( ( [ key, value ] ) => holds( resolved?.[ key ], value ) );

}

/** A blueprint without its names and naming record: what naming leaves as it found it. */
function unnamed( value, field = null ) {

	if ( Array.isArray( value ) ) return value.map( ( entry ) => unnamed( entry ) );
	if ( ! value || typeof value !== 'object' ) return value;
	return Object.fromEntries( Object.entries( value )
		.filter( ( [ key ] ) => key !== 'name' && ! ( field === 'meta' && key === 'naming' ) )
		.map( ( [ key, entry ] ) => [ key, unnamed( entry, key ) ] ) );

}

/** @returns Map of questId to the step kinds it uses that the game does not play */
function unplayableSteps( definitions ) {

	const unplayable = new Map();
	for ( const definition of definitions ) {

		const kinds = [ ...new Set( definition.steps.map( ( step ) => step.target?.kind ) ) ].filter( ( kind ) => ! PLAYABLE_MECHANICS.includes( kind ) );
		if ( kinds.length ) unplayable.set( definition.id, `has steps the game does not play: ${kinds.join( ', ' )}` );

	}
	return unplayable;

}

/**
 * Keeps what a story was made from beside the draft's quests: the recording,
 * the author's notes on the run and its Markdown stages, and the questlines
 * creation left out with why.
 */
async function keepStory( recording, storyDir, leftOut ) {

	await mkdir( storyDir, { recursive: true } );
	for ( const entry of await readdir( recording, { withFileTypes: true } ) ) {

		if ( entry.isFile() && ( [ 'recording.json', 'meta.json' ].includes( entry.name ) || entry.name.endsWith( '.md' ) ) ) {

			await cp( join( recording, entry.name ), join( storyDir, entry.name ) );

		}

	}
	await writeJson( join( storyDir, 'left-out.json' ), leftOut );

}

function parse( bytes, label ) {

	try {

		return JSON.parse( bytes );

	} catch ( error ) {

		throw new CreationError( 'E_INVALID_REQUEST', `${label} is no JSON: ${error.message}` );

	}

}

function safeId( name, seed ) {

	const slug = ( value ) => value.toLowerCase().normalize( 'NFKD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
	return ( slug( name ) || slug( seed ) || 'city' ).slice( 0, 64 ).replace( /[-._]+$/g, '' );

}

function sameIds( left, right ) {

	return left.length === right.length && left.every( ( id ) => right.includes( id ) );

}

async function json( path, label ) {

	try {

		return JSON.parse( await readFile( path, 'utf8' ) );

	} catch ( error ) {

		throw new CreationError( 'E_OUTPUT_INVALID', `${label} is unavailable: ${error.message}` );

	}

}

function writeJson( path, value ) {

	return writeFile( path, JSON.stringify( value, null, 2 ) + '\n' );

}

async function readQuestBundle( directory, label ) {

	const manifest = await json( join( directory, 'quest-bundle.json' ), `${label} manifest` );
	const checked = bundleOperation( () => questBundleManifest( manifest ), `${label} manifest` );
	const catalogs = Object.fromEntries( await Promise.all( questBundleFiles( checked ).map( async ( name ) => [
		name, await json( join( directory, checked.files[ name ] ), `${label} ${name}` )
	] ) ) );
	return bundleOperation( () => questBundle( checked, catalogs ), label );

}

async function writeQuestBundle( directory, bundle ) {

	await Promise.all( questBundleFiles( bundle.manifest ).map( ( name ) =>
		writeJson( join( directory, bundle.manifest.files[ name ] ), bundle[ name ] )
	) );
	await writeJson( join( directory, 'quest-bundle.json' ), bundle.manifest );

}

function bundleOperation( operation, label ) {

	try {

		return operation();

	} catch ( error ) {

		throw new CreationError( 'E_OUTPUT_INVALID', `${label} is invalid: ${error.message}` );

	}

}

async function exists( path ) {

	try { await lstat( path ); return true; } catch ( error ) {

		if ( error.code === 'ENOENT' ) return false;
		throw new CreationError( 'E_STORAGE', `cannot inspect ${path}: ${error.message}` );

	}

}

function runCommand( command, args, { progress = null, ...options } = {} ) {

	return new Promise( ( resolvePromise, reject ) => {

		const child = spawn( command, args, { ...options, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let output = '';
		let told = 0;
		const read = ( chunk ) => {

			output += chunk;
			if ( ! progress ) return;
			const end = output.lastIndexOf( '\n' );
			if ( end < told ) return;
			const line = output.slice( told, end ).split( '\n' ).map( ( text ) => text.trim() ).filter( Boolean ).at( - 1 );
			told = end + 1;
			if ( line ) progress( line );

		};
		child.stdout.on( 'data', read );
		child.stderr.on( 'data', read );
		child.on( 'error', ( error ) => reject( new CreationError( 'E_COMMAND_FAILED', error.message, 500 ) ) );
		child.on( 'close', ( status ) => status === 0
			? resolvePromise( output )
			: reject( new CreationError( 'E_COMMAND_FAILED', failure( output ) || `${command} exited ${status}`, 500 ) ) );

	} );

}

/** A failed command's last lines, where it says what stopped it; a long stage logs thousands before that. */
function failure( output ) {

	const lines = output.trim().split( '\n' );
	return ( lines.length > FAILURE_LINES ? [ `... ${lines.length - FAILURE_LINES} lines before`, ...lines.slice( - FAILURE_LINES ) ] : lines ).join( '\n' );

}
