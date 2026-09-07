import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createLibrary, LibraryError } from '../../library/index.js';
import {
	QUEST_BUNDLE_FILES, questBundle, questBundleManifest, selectQuestBundle
} from '../../quest-bundle/index.js';
import { Boundary } from './Boundary.js';
import { CreationError } from './CreationError.js';
import { CityTemplate } from './CityTemplate.js';
import { cityDescriptor, gameDescriptor } from './descriptors.js';

const SIDE_JOB_LIMIT = 3;
const MAIN_LOCATION_COUNT = 7;
const NPC_TYPES = 'creation/fixtures/urbe-cyberpunk.npc-types.json';
const RECORDING = 'creation/samples/urbe-small/recording.json';

export class WorldCreation {

	constructor( config, { run = runCommand, clock = () => new Date(), library = null } = {} ) {

		this.boundary = new Boundary();
		this.boundary.assert( 'config', config );
		this.engineRoot = resolve( config.engineRoot );
		this.atlasRoot = resolve( config.atlasRoot );
		this.questsRoot = resolve( config.questsRoot );
		this.outDir = resolve( config.outDir );
		this.run = run;
		this.clock = clock;
		this.library = library ?? createLibrary( { outDir: this.outDir } );

	}

	async generateCity( input ) {

		this.boundary.assert( 'generate-city', input );
		const template = new CityTemplate( input );
		input = template.input;
		const id = safeId( input.name, input.seed );
		const target = join( this.outDir, 'cities', id );
		if ( await exists( target ) ) throw new CreationError( 'E_EXISTS', `city ${id} already exists`, 409 );

		const temporary = await this.#temporary( 'city-' );
		const blueprint = join( temporary, 'blueprint.json' );
		const world = join( temporary, 'world' );

		try {

			await this.run( 'npm', template.command( blueprint ), { cwd: this.atlasRoot } );
			await this.run( 'npm', [
				'run', 'assemble-city', '--', '--blueprint', blueprint, '--out', world,
				'--workers', '4', '--interiors', '0'
			], { cwd: this.engineRoot } );
			const atlas = await json( join( world, 'blueprint.json' ), 'generated city blueprint' );
			const manifest = await json( join( world, 'manifest.json' ), 'generated city manifest' );
			if ( manifest.parcels.length !== atlas.parcels.length || manifest.interiors.length !== 0 ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'city stage must contain every shell and no interiors' );

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

	async generateInstances( input ) {

		this.boundary.assert( 'generate-instances', input );
		const city = await this.#city( input.cityId );
		const eligible = new Set( city.buildings.filter( ( building ) => building.eligible ).map( ( building ) => building.id ) );
		if ( input.mode === 'manual' && input.count !== input.buildingIds.length ) {

			throw new CreationError( 'E_INVALID_REQUEST', 'manual interior count must match the selected building ids' );

		}
		if ( input.buildingIds.some( ( id ) => ! eligible.has( id ) ) ) {

			throw new CreationError( 'E_INVALID_REQUEST', 'interior selection contains an ineligible building' );

		}

		const temporary = await this.#temporary( 'instances-' );
		const world = join( temporary, 'world' );
		try {

			await cp( join( this.outDir, 'cities', city.id ), world, { recursive: true } );
			await rm( join( world, 'city.json' ), { force: true } );
			const handoff = await this.#materialize( city, world );
			const required = questParcelIds( handoff.questlines );
			let selected;
			if ( input.mode === 'manual' ) selected = input.buildingIds;
			else {

				if ( input.count < MAIN_LOCATION_COUNT ) {

					throw new CreationError( 'E_QUEST_LOCATIONS', `the main story needs at least ${MAIN_LOCATION_COUNT} interior locations` );

				}
				selected = [ ...required ];
				for ( const building of city.buildings ) {

					if ( selected.length >= input.count ) break;
					if ( building.eligible && ! selected.includes( building.id ) ) selected.push( building.id );

				}
				selected = selected.slice( 0, input.count );

			}
			if ( selected.length !== input.count ) {

				throw new CreationError( 'E_INVALID_REQUEST', `city ${city.id} has only ${selected.length} eligible interiors` );

			}

			const args = [
				'run', 'assemble-city', '--', '--blueprint', join( world, 'blueprint.json' ), '--out', world,
				'--workers', '1', '--reuse-shells', 'true', '--interior-parcels', selected.join( ',' )
			];
			await this.run( 'npm', args, { cwd: this.engineRoot } );
			const manifest = await json( join( world, 'manifest.json' ), 'interior manifest' );
			if ( ! sameIds( manifest.interiors, selected ) ) {

				throw new CreationError( 'E_OUTPUT_INVALID', 'interior stage did not publish the exact selected buildings' );

			}
			await writeJson( join( world, 'draft.json' ), {
				contractVersion: '1.0.0', cityId: city.id, interiorIds: manifest.interiors, questId: null
			} );
			await this.#publishDraft( city.id, world );
			const result = { ids: manifest.interiors, count: manifest.interiors.length };
			this.boundary.assert( 'instances-result', result );
			return result;

		} finally {

			await rm( temporary, { recursive: true, force: true } );

		}

	}

	async generateQuests( input ) {

		this.boundary.assert( 'generate-quests', input );
		if ( input.mainBrief.trim() ) {

			throw new CreationError( 'E_STORY_BRIEF_UNAVAILABLE', 'custom story generation needs an explicitly configured external model' );

		}
		if ( input.sideJobs > SIDE_JOB_LIMIT ) {

			throw new CreationError( 'E_SIDE_JOB_LIMIT', `the deterministic story set contains ${SIDE_JOB_LIMIT} side jobs` );

		}
		const draftDir = join( this.outDir, 'drafts', input.cityId );
		const draft = await this.#draft( input.cityId );
		if ( ! sameIds( draft.interiorIds, input.interiorIds ) ) {

			throw new CreationError( 'E_STAGE_MISMATCH', 'quest input does not match the current interior stage' );

		}
		const questsDir = join( draftDir, 'quests' );
		const all = await readQuestBundle( questsDir, 'materialized quest bundle' );
		const definitions = all.questlines.slice( 0, 1 + input.sideJobs );
		const missing = questParcelIds( definitions ).filter( ( id ) => ! input.interiorIds.includes( id ) );
		if ( missing.length ) {

			throw new CreationError( 'E_QUEST_LOCATIONS', `quests need interiors not selected in stage 2: ${missing.join( ', ' )}` );

		}
		const selected = bundleOperation( () => selectQuestBundle(
			all, definitions.map( ( definition ) => definition.id )
		), 'materialized quest bundle selection' );
		await writeQuestBundle( questsDir, selected );
		const questId = `${input.cityId}-quests-${input.sideJobs}`;
		await writeJson( join( draftDir, 'draft.json' ), { ...draft, questId } );
		const result = { id: questId, mainSteps: definitions[ 0 ].steps.length, sideJobs: definitions.length - 1 };
		this.boundary.assert( 'quests-result', result );
		return result;

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
			await rm( join( world, 'city.json' ), { force: true } );
			if ( ! hasQuests ) await rm( join( world, 'quests' ), { recursive: true, force: true } );
			await rm( join( world, 'quests', 'all.questlines.json' ), { force: true } );
			await rm( join( world, 'quests', 'questlines.meta.json' ), { force: true } );
			await rm( join( world, 'draft.json' ), { force: true } );
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

	async #materialize( city, world ) {

		const questsDir = join( world, 'quests' );
		await mkdir( questsDir, { recursive: true } );
		const types = join( world, 'npc-types.json' );
		await cp( join( this.questsRoot, NPC_TYPES ), types );
		const output = join( questsDir, 'all.questlines.json' );
		await this.run( 'npm', [
			'run', 'materialize', '--', join( this.questsRoot, RECORDING ), city.size,
			join( world, 'blueprint.json' ), types, output
		], { cwd: this.questsRoot } );
		return readQuestBundle( questsDir, 'materialized quest bundle' );

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

	async #publishDraft( id, source ) {

		const root = join( this.outDir, 'drafts' );
		const target = join( root, id );
		const backup = join( root, `.${id}.previous` );
		await mkdir( root, { recursive: true } );
		await rm( backup, { recursive: true, force: true } );
		const previous = await exists( target );
		if ( previous ) await rename( target, backup );
		try {

			await rename( source, target );
			await rm( backup, { recursive: true, force: true } );

		} catch ( error ) {

			if ( previous && ! await exists( target ) ) await rename( backup, target );
			throw new CreationError( 'E_STORAGE', `cannot publish interior stage: ${error.message}` );

		}

	}

}

function safeId( name, seed ) {

	const slug = ( value ) => value.toLowerCase().normalize( 'NFKD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
	return ( slug( name ) || slug( seed ) || 'city' ).slice( 0, 64 ).replace( /[-._]+$/g, '' );

}

function questParcelIds( value ) {

	const ids = [];
	const seen = new Set();
	const visit = ( node ) => {

		if ( Array.isArray( node ) ) return node.forEach( visit );
		if ( ! node || typeof node !== 'object' ) return;
		for ( const [ key, child ] of Object.entries( node ) ) {

			if ( ( key === 'parcelId' || key === 'atParcelId' ) && typeof child === 'string' ) {

				if ( ! seen.has( child ) ) { seen.add( child ); ids.push( child ); }

			} else visit( child );

		}

	};
	visit( value );
	return ids;

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
	const catalogs = Object.fromEntries( await Promise.all( QUEST_BUNDLE_FILES.map( async ( name ) => [
		name, await json( join( directory, checked.files[ name ] ), `${label} ${name}` )
	] ) ) );
	return bundleOperation( () => questBundle( checked, catalogs ), label );

}

async function writeQuestBundle( directory, bundle ) {

	await Promise.all( QUEST_BUNDLE_FILES.map( ( name ) =>
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

function runCommand( command, args, options ) {

	return new Promise( ( resolvePromise, reject ) => {

		const child = spawn( command, args, { ...options, stdio: [ 'ignore', 'pipe', 'pipe' ] } );
		let output = '';
		child.stdout.on( 'data', ( chunk ) => output += chunk );
		child.stderr.on( 'data', ( chunk ) => output += chunk );
		child.on( 'error', ( error ) => reject( new CreationError( 'E_COMMAND_FAILED', error.message, 500 ) ) );
		child.on( 'close', ( status ) => status === 0
			? resolvePromise( output )
			: reject( new CreationError( 'E_COMMAND_FAILED', output.trim() || `${command} exited ${status}`, 500 ) ) );

	} );

}
