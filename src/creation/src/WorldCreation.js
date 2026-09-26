import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fnv1a } from '../../assembly/hash.js';
import { questParcelIds } from '../../assembly/InteriorSelection.js';
import sceneryCapabilities from '../../game/scenery/capabilities.json' with { type: 'json' };
import { createLibrary, LibraryError } from '../../library/index.js';
import {
	questBundle, questBundleFiles, questBundleManifest, selectQuestBundle
} from '../../quest-bundle/index.js';
import { Boundary } from './Boundary.js';
import { CreationError } from './CreationError.js';
import { CityTemplate } from './CityTemplate.js';
import { cityDescriptor, gameDescriptor } from './descriptors.js';
import { SceneryPreflight } from './SceneryPreflight.js';

const SIDE_JOB_LIMIT = 3;
const MAIN_LOCATION_COUNT = 7;
/** How much of a failed command's output its error carries. */
const FAILURE_LINES = 40;
const NPC_TYPES = 'creation/samples/urbe-small/npc-types.json';
const RECORDING = 'creation/samples/urbe-small/recording.json';
/** The Materials theme the game and its buildings wear. */
const THEME = 'cyberpunk';
const STAGE_INPUTS = {
	generateCity: 'generate-city', generateInstances: 'generate-instances',
	generateQuests: 'generate-quests', createGame: 'create-game'
};
/**
 * A named city opens a home first, then one building of each kind that hires,
 * round after round, so an authored story has somewhere to live and a spread
 * of places to meet people.
 */
const SPREAD = [
	'residential', 'commerce', 'restaurant', 'clinic', 'police', 'corpo', 'coffee_shop',
	'offices', 'hotel', 'hospital', 'mall', 'factory', 'military'
];

/**
 * The step kinds the game plays whole, in the Quests catalog order. Left out:
 * assassination, whose only lethal path is traffic the player does not drive;
 * rescue, access, hacking and sabotage, whose fixed targets creation does not
 * bind; transportation, whose journey needs a transit line the story cannot see.
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
		this.namingRoot = config.namingRoot ? resolve( config.namingRoot ) : null;
		this.outDir = resolve( config.outDir );
		this.model = config.model ?? null;
		this.preflight = preflight ?? new SceneryPreflight( { themesDir: resolve( config.themesDir ), theme: THEME } );
		this.run = run;
		this.clock = clock;
		this.library = library ?? createLibrary( { outDir: this.outDir } );

	}

	/** Checks one stage's input without running it, so a queued stage is refused at once. */
	check( method, input ) {

		if ( ! Object.hasOwn( STAGE_INPUTS, method ) ) throw new CreationError( 'E_INVALID_REQUEST', `${method} is no creation stage` );
		this.boundary.assert( STAGE_INPUTS[ method ], input );

	}

	async generateCity( input, { progress = null } = {} ) {

		const run = this.#runner( progress );
		this.boundary.assert( 'generate-city', input );
		const template = new CityTemplate( input );
		input = template.input;
		if ( input.theme && ! ( this.namingRoot && this.model ) ) {

			throw new CreationError( 'E_NAMING_UNAVAILABLE', 'a themed city is named through the model server: set LLM_BASE_URL', 503 );

		}
		const id = safeId( input.name, input.seed );
		const target = join( this.outDir, 'cities', id );
		if ( await exists( target ) ) throw new CreationError( 'E_EXISTS', `city ${id} already exists`, 409 );

		const temporary = await this.#temporary( 'city-' );
		const blueprint = join( temporary, 'blueprint.json' );
		const world = join( temporary, 'world' );

		try {

			await run( 'npm', template.command( blueprint ), { cwd: this.atlasRoot } );
			// Names go in before anything is built: the world binds its blueprint's
			// bytes, and every sign and quest place reads its names from them.
			if ( input.theme ) {

				await run( 'npm', [ 'run', 'world', '--', temporary, '--theme', input.theme ], { cwd: this.namingRoot, env: this.#modelEnv() } );

			}
			await run( 'npm', [
				'run', 'assemble-city', '--', '--blueprint', input.theme ? join( temporary, 'blueprint.named.json' ) : blueprint,
				'--out', world, '--interiors', '0'
			], { cwd: this.engineRoot } );
			const atlas = await json( join( world, 'blueprint.json' ), 'generated city blueprint' );
			const manifest = await json( join( world, 'manifest.json' ), 'generated city manifest' );
			// Every parcel stands, is a shell, or is an empty lot on purpose; none is unaccounted for.
			const sources = manifest.sources ?? {};
			if ( atlas.parcels.some( ( parcel ) => ! [ 'kit', 'shell', 'empty' ].includes( sources[ parcel.id ] ) ) || manifest.interiors.length !== 0 ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'city stage must account for every parcel and hold no interiors' );

			}
			if ( input.theme && ( manifest.named !== true || manifest.namingTheme !== input.theme || ! existsSync( join( world, 'npc-types.json' ) ) ) ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'city stage did not assemble the named world with its people' );

			}

			await mkdir( join( this.outDir, 'cities' ), { recursive: true } );
			await rename( world, target );
			const city = await cityDescriptor( target, id, input, atlas, this.clock() );
			try {

				await this.library.saveCity( city );

			} catch ( error ) {

				await rm( target, { recursive: true, force: true } );
				throw error;

			}
			return this.boundary.assert( 'city-result', city );

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

			await cp( join( this.outDir, 'cities', city.id ), world, { recursive: true } );
			await rm( join( world, 'city.json' ), { force: true } );
			const named = ( await json( join( world, 'manifest.json' ), 'city manifest' ) ).named === true;
			// An unnamed city plays the recorded story's people.
			const types = join( world, 'npc-types.json' );
			if ( ! named && ! existsSync( types ) ) await cp( join( this.questsRoot, NPC_TYPES ), types );
			// A named city's story is written once its interiors are open, so it
			// opens a spread of kinds. The recorded story is written for the whole
			// city first and its places open first, in story order.
			const priority = manual ? [] : named
				? venueSpread( await json( join( world, 'blueprint.json' ), 'city blueprint' ) )
				: questParcelIds( ( await this.#materialize( run, city, world, join( temporary, 'ranking' ) ) ).questlines );

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

	async generateQuests( input, { progress = null } = {} ) {

		const run = this.#runner( progress );
		this.boundary.assert( 'generate-quests', input );
		if ( input.sideJobs > SIDE_JOB_LIMIT ) {

			throw new CreationError( 'E_SIDE_JOB_LIMIT', `a game carries at most ${SIDE_JOB_LIMIT} side jobs` );

		}
		const city = await this.#city( input.cityId );
		const draftDir = join( this.outDir, 'drafts', input.cityId );
		const draft = await this.#draft( input.cityId );
		if ( ! sameIds( draft.interiorIds, input.interiorIds ) ) {

			throw new CreationError( 'E_STAGE_MISMATCH', 'quest input does not match the current interior stage' );

		}
		const brief = input.mainBrief.trim();
		const authored = brief !== '' || ( await json( join( draftDir, 'manifest.json' ), 'draft manifest' ) ).named === true;
		if ( authored && ! this.model ) {

			throw new CreationError( 'E_STORY_BRIEF_UNAVAILABLE', 'a written story needs the model server: set LLM_BASE_URL', 503 );

		}

		const temporary = await this.#temporary( 'quests-' );
		try {

			const questsDir = join( temporary, 'quests' );
			const storyDir = join( temporary, 'story' );
			// The assembler skips any building Interior cannot furnish, so either
			// story is written against the interiors that opened. Without this a
			// story can name a building the player cannot walk into.
			const all = authored
				? await this.#author( run, city, draftDir, draft, brief, temporary, questsDir, storyDir ).catch( async ( error ) => {

					// A failed story keeps what the model said and where it stopped.
					if ( await exists( storyDir ) ) await publish( join( draftDir, 'story' ), storyDir, 'failed story' );
					throw error;

				} )
				: await this.#materialize( run, city, draftDir, questsDir, draft.interiorIds );
			// A scene that cannot stand leaves its investigation unfinishable: a
			// side job with one is left out, and the main story fails here.
			const blocked = await this.#standScenery( draftDir, all );
			const [ main, ...sides ] = all.questlines;
			if ( blocked.has( main.id ) ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `the main story cannot stand in city ${city.id}: ${blocked.get( main.id )}` );

			}
			const definitions = [ main, ...sides.filter( ( definition ) => ! blocked.has( definition.id ) ).slice( 0, input.sideJobs ) ];
			const missing = questParcelIds( definitions ).filter( ( id ) => ! input.interiorIds.includes( id ) );
			if ( missing.length ) {

				throw new CreationError( 'E_QUEST_LOCATIONS', `quests need interiors not selected in stage 2: ${missing.join( ', ' )}` );

			}
			const selected = bundleOperation( () => selectQuestBundle(
				all, definitions.map( ( definition ) => definition.id )
			), 'quest bundle selection' );
			await writeQuestBundle( questsDir, selected );
			await publish( join( draftDir, 'quests' ), questsDir, 'quest stage' );
			if ( authored ) await publish( join( draftDir, 'story' ), storyDir, 'quest stage' );
			const questId = `${input.cityId}-${authored ? 'story' : 'quests'}-${definitions.length - 1}`;
			await writeJson( join( draftDir, 'draft.json' ), { ...draft, questId } );
			const result = { id: questId, mainSteps: main.steps.length, sideJobs: definitions.length - 1 };
			this.boundary.assert( 'quests-result', result );
			return result;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

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

			await cp( join( this.outDir, needsDraft ? 'drafts' : 'cities', city.id ), world, { recursive: true } );
			// A game carries its bundle alone: what the story was written from,
			// the unselected definitions and the creation stages stay in the draft.
			for ( const path of [
				'city.json', 'draft.json', 'story', ...( hasQuests ? [] : [ 'quests' ] ),
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

	/**
	 * Replays the recorded story over a world into a bundle in `questsDir`,
	 * against what the game plays and stands.
	 * @param within the parcels the story may use, or nothing for the whole city.
	 * A venue that cannot stand inside the set moves to a compatible parcel that
	 * is in it, so every place the story names is a building the player opens.
	 */
	async #materialize( run, city, world, questsDir, within = null ) {

		await run( 'npm', [
			'run', 'materialize', '--', join( this.questsRoot, RECORDING ), city.size,
			join( world, 'blueprint.json' ), join( world, 'npc-types.json' ), join( questsDir, 'all.questlines.json' ),
			await handoffInput( questsDir ), ...( within ? [ `--parcels=${within.join( ',' )}` ] : [] )
		], { cwd: this.questsRoot } );
		return readQuestBundle( questsDir, 'materialized quest bundle' );

	}

	/**
	 * Writes a story with the model server against the draft's opened
	 * interiors, in the step kinds the game plays, into a bundle in
	 * `questsDir`. What the model said and each stage it wrote land in `storyDir`.
	 */
	async #author( run, city, draftDir, draft, brief, temporary, questsDir, storyDir ) {

		const parcels = join( temporary, 'parcels.json' );
		await writeJson( parcels, draft.interiorIds );
		const prompt = join( temporary, 'brief.txt' );
		if ( brief ) await writeFile( prompt, brief + '\n' );
		await run( 'npm', [
			'run', 'author', '--', '--world', join( draftDir, 'blueprint.json' ), '--types', join( draftDir, 'npc-types.json' ),
			'--out', storyDir, '--questlines', join( questsDir, 'all.questlines.json' ), `--parcels=@${parcels}`,
			'--mechanics', PLAYABLE_MECHANICS.join( ',' ), '--handoff', await handoffInput( questsDir ), '--profile', city.size,
			...( brief ? [ `--prompt=@${prompt}` ] : [] )
		], { cwd: this.questsRoot, env: this.#modelEnv() } );
		return readQuestBundle( questsDir, 'written quest bundle' );

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

	/** The model server for a child command: its address, and its model when one is named, else the first it serves. */
	#modelEnv() {

		const env = { ...process.env, LLM_BASE_URL: this.model.baseUrl };
		if ( this.model.model ) env.LLM_MODEL = this.model.model;
		else delete env.LLM_MODEL;
		return env;

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

/** Every building a named city can open, a home first, then one of each kind that hires, round after round. */
function venueSpread( atlas ) {

	const rank = ( a, b ) => fnv1a( `${atlas.meta.seed}:spread:${a}` ) - fnv1a( `${atlas.meta.seed}:spread:${b}` ) || a.localeCompare( b );
	const kinds = SPREAD.map( ( type ) => atlas.parcels.filter( ( parcel ) => parcel.type === type ).map( ( parcel ) => parcel.id ).sort( rank ) );
	const spread = [];
	for ( let round = 0; kinds.some( ( ids ) => round < ids.length ); round ++ ) {

		for ( const ids of kinds ) if ( round < ids.length ) spread.push( ids[ round ] );

	}
	return spread;

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
