import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldCreation, CreationError } from './index.js';
import { HOST_CAPABILITIES, PLAYABLE_MECHANICS } from './src/WorldCreation.js';

const NOW = new Date( '2026-09-03T12:30:00Z' );
const THEMES = fileURLToPath( new URL( '../../../materials/themes', import.meta.url ) );
const MODEL = { baseUrl: 'http://models.test/v1' };

describe( 'playable world creation contract', () => {

	const roots = [];

	afterEach( async () => {

		await Promise.all( roots.splice( 0 ).map( ( root ) => rm( root, { recursive: true, force: true } ) ) );

	} );

	it( 'publishes the four stages as separate city, draft and playable game artifacts, and free play beside them', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );

		const city = await creation.generateCity( { name: 'Canal Ward', seed: 'canal-17', size: 'small' } );
		expect( city ).toMatchObject( {
			id: 'canal-ward', size: 'small', seed: 'canal-17', generatedAt: NOW.toISOString(),
			districtCount: 1, buildings: expect.arrayContaining( [ expect.objectContaining( { id: 'p0', eligible: true } ) ] )
		} );
		expect( await readJson( join( fixture.config.outDir, 'cities/canal-ward/manifest.json' ) ) ).toMatchObject( {
			parcels: parcelIds(), interiors: []
		} );
		expect( fixture.calls[ 0 ] ).toMatchObject( { kind: 'atlas', command: 'npm' } );
		expect( fixture.calls[ 0 ].args.slice( 0, 7 ) ).toEqual( [
			'run', 'generate', '--', '--seed', 'canal-17', '--out', expect.any( String )
		] );
		expect( fixture.calls[ 0 ].args ).toEqual( expect.arrayContaining( [ '--size', '500' ] ) );

		const instances = await creation.generateInstances( {
			cityId: city.id, mode: 'automatic', count: 9, buildingIds: []
		} );
		expect( instances ).toEqual( { ids: parcelIds().slice( 0, 9 ), count: 9 } );
		expect( await readJson( join( fixture.config.outDir, 'drafts/canal-ward/manifest.json' ) ) ).toMatchObject( {
			interiors: instances.ids
		} );

		const quests = await creation.generateQuests( {
			cityId: city.id, interiorIds: instances.ids, mainBrief: '', sideJobs: 3
		} );
		expect( quests ).toEqual( { id: 'canal-ward-quests-3', mainSteps: 10, sideJobs: 3 } );

		const game = await creation.createGame( {
			cityId: city.id, interiorIds: instances.ids, questId: quests.id
		} );
		expect( game ).toMatchObject( {
			id: 'canal-ward', cityId: 'canal-ward', selectedInteriors: instances.ids,
			questBundle: { uri: 'quests/quest-bundle.json', mediaType: 'application/json' },
			quests: [ { id: 'main-line', state: 'active', totalSteps: 10 } ],
			sideJobs: [
				{ id: 'side-one', state: 'available', totalSteps: 5 },
				{ id: 'side-two', state: 'available', totalSteps: 5 },
				{ id: 'side-three', state: 'available', totalSteps: 5 }
			],
			save: { revision: 1, playTimeSeconds: 0, createdAt: NOW.toISOString() }
		} );
		expect( await readJson( join( fixture.config.outDir, 'games/canal-ward/game.json' ) ) ).toEqual( game );
		const bundleDir = join( fixture.config.outDir, 'games/canal-ward/quests' );
		expect( await readJson( join( bundleDir, 'quest-bundle.json' ) ) ).toMatchObject( {
			files: { questlines: 'questlines.json' },
			counts: {
				questlines: 4, objectives: 25, investigations: 0, mechanicTargetBindings: 0,
				missionAssetRequests: 4, missionItemBindings: 4
			}
		} );
		expect( await readJson( join( bundleDir, 'mission-item-bindings.json' ) ) ).toHaveLength( 4 );
		// Authoring metadata and unselected definitions stay out of a published game.
		for ( const absent of [
			'games/canal-ward/draft.json', 'games/canal-ward/quests/all.questlines.json',
			'games/canal-ward/quests/questlines.meta.json', 'games/canal-ward/quests/handoff-input.json'
		] ) {

			await expect( readFile( join( fixture.config.outDir, absent ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

		}
		// The story is written once for the assembler to rank the buildings it
		// wants, and again against the ones that opened, so it never names a
		// building the player cannot walk into.
		expect( fixture.calls.map( ( call ) => call.kind ) ).toEqual( [ 'atlas', 'shells', 'materialize', 'interiors', 'materialize' ] );
		expect( valueAfter( fixture.calls[ 3 ].args, '--interior-priority' ) ).toBe( 'p0,p1,p2,p3,p4,p5,p6,p7,p8' );
		expect( fixture.calls.at( - 1 ).args.some( ( arg ) => String( arg ).startsWith( '--parcels=' ) ) ).toBe( true );
		// Every replay is told what the game plays and stands.
		const handoff = fixture.calls.at( - 1 ).args[ fixture.calls.at( - 1 ).args.indexOf( '--' ) + 6 ];
		expect( handoff ).toMatch( /quests\/handoff-input\.json$/ );
		expect( await readJson( join( fixture.config.outDir, 'drafts/canal-ward/quests/handoff-input.json' ) ) ).toEqual( { hostCapabilities: HOST_CAPABILITIES } );

		const free = { cityId: city.id, interiorIds: [], questId: null };
		const first = await creation.createGame( free );
		const second = await creation.createGame( free );
		expect( second.id ).not.toBe( first.id );
		for ( const play of [ first, second ] ) {

			expect( play ).toMatchObject( { cityId: city.id, selectedInteriors: [], questBundle: null, quests: [], sideJobs: [] } );
			await expect( readFile( join( fixture.config.outDir, 'games', play.id, 'quests/quest-bundle.json' ) ) )
				.rejects.toMatchObject( { code: 'ENOENT' } );

		}
		// Free play copies the city shell; it runs no further generation command.
		expect( fixture.calls.map( ( call ) => call.kind ) ).toEqual( [ 'atlas', 'shells', 'materialize', 'interiors', 'materialize' ] );

	} );

	it( 'fails closed on every stage request it cannot serve, leaving the city shell-only', async () => {

		const fixture = await setup();
		const { model, ...unmodelled } = fixture.config;
		expect( model ).toEqual( MODEL );
		const creation = createWorldCreation( unmodelled, { run: fixture.run, clock: () => NOW } );
		await expectCode( creation.generateCity( { size: 'small', theme: 'salt-stained harbour' } ), 'E_NAMING_UNAVAILABLE' );
		await expectCode( creation.generateCity( { size: 'small', theme: '   ' } ), 'E_INVALID_REQUEST' );
		expect( () => creation.check( 'generateCity', { size: 'tiny' } ) ).toThrow( CreationError );
		expect( () => creation.check( 'catalog', {} ) ).toThrow( 'catalog is no creation stage' );
		const city = await creation.generateCity( { name: 'Strict City', seed: 'strict', size: 'medium' } );

		await expectCode( creation.generateInstances( {
			cityId: city.id, mode: 'automatic', count: 6, buildingIds: []
		} ), 'E_QUEST_LOCATIONS' );
		await expectCode( creation.generateInstances( {
			cityId: city.id, mode: 'manual', count: 2, buildingIds: [ 'p0' ]
		} ), 'E_INVALID_REQUEST' );
		await expectCode( creation.generateInstances( {
			cityId: city.id, mode: 'manual', count: 1, buildingIds: [ 'missing' ]
		} ), 'E_INVALID_REQUEST' );
		await expectCode( creation.generateInstances( {
			cityId: 'absent-city', mode: 'manual', count: 1, buildingIds: [ 'p0' ]
		} ), 'E_CITY_NOT_FOUND' );
		await expectCode( creation.generateCity( { name: 'Strict City', seed: 'strict', size: 'medium' } ), 'E_EXISTS' );
		await expectCode( creation.generateQuests( {
			cityId: city.id, interiorIds: parcelIds().slice( 0, 9 ), mainBrief: '', sideJobs: 3
		} ), 'E_DRAFT_NOT_FOUND' );

		const instances = await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [] } );
		await expectCode( creation.generateQuests( {
			cityId: city.id, interiorIds: instances.ids, mainBrief: 'invent a new plot', sideJobs: 3
		} ), 'E_STORY_BRIEF_UNAVAILABLE' );
		await expectCode( creation.generateQuests( {
			cityId: city.id, interiorIds: instances.ids, mainBrief: '', sideJobs: 4
		} ), 'E_SIDE_JOB_LIMIT' );
		await expectCode( creation.generateQuests( {
			cityId: city.id, interiorIds: instances.ids.slice( 0, 8 ), mainBrief: '', sideJobs: 3
		} ), 'E_STAGE_MISMATCH' );
		await expectCode( creation.createGame( {
			cityId: city.id, interiorIds: instances.ids, questId: 'not-the-stage'
		} ), 'E_STAGE_MISMATCH' );
		await expectCode( creation.createGame( {
			cityId: city.id, interiorIds: [ 'p1' ], questId: null
		} ), 'E_STAGE_MISMATCH' );

		expect( await readJson( join( fixture.config.outDir, 'cities/strict-city/manifest.json' ) ) ).toMatchObject( { interiors: [] } );

	} );

	it( 'names a themed city before building it and writes its story through the model against the interiors it opened', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );

		const told = [];
		const city = await creation.generateCity(
			{ name: 'Salt Ward', seed: 'salt-3', size: 'small', theme: ' salt-stained harbour ' }, { progress: ( line ) => told.push( line ) }
		);
		expect( told ).toEqual( [ 'atlas done', 'naming done', 'shells done' ] );
		const [ atlasCall, naming, shells ] = fixture.calls;
		expect( [ atlasCall.kind, naming.kind, shells.kind ] ).toEqual( [ 'atlas', 'naming', 'shells' ] );
		expect( naming.args.slice( 0, 3 ) ).toEqual( [ 'run', 'world', '--' ] );
		expect( naming.args.slice( 4 ) ).toEqual( [ '--theme', 'salt-stained harbour' ] );
		expect( naming.options ).toMatchObject( { cwd: fixture.config.namingRoot, env: { LLM_BASE_URL: MODEL.baseUrl } } );
		expect( naming.options.env ).not.toHaveProperty( 'LLM_MODEL' );
		expect( valueAfter( shells.args, '--blueprint' ) ).toBe( join( naming.args[ 3 ], 'blueprint.named.json' ) );
		expect( city.buildings.find( ( building ) => building.id === 'p9' ) ).toMatchObject( { label: 'Harbour Home p9', type: 'residential' } );
		expect( await readJson( join( fixture.config.outDir, 'cities/salt-ward/manifest.json' ) ) ).toMatchObject( {
			named: true, namingTheme: 'salt-stained harbour'
		} );

		// A named city opens a home first, then a spread of the kinds that hire; its story is not the recorded one.
		const instances = await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [] } );
		const opened = fixture.calls.at( - 1 );
		expect( opened.kind ).toBe( 'interiors' );
		expect( valueAfter( opened.args, '--interior-priority' ).split( ',' ).slice( 0, 3 ) ).toEqual( [ 'p9', expect.any( String ), expect.any( String ) ] );
		expect( fixture.calls.map( ( call ) => call.kind ) ).not.toContain( 'materialize' );
		expect( instances.ids[ 0 ] ).toBe( 'p9' );

		const quests = await creation.generateQuests( {
			cityId: city.id, interiorIds: instances.ids, mainBrief: '  A courier vanishes on the night shift.  ', sideJobs: 3
		} );
		expect( quests ).toEqual( { id: 'salt-ward-story-2', mainSteps: 10, sideJobs: 2 } );
		const author = fixture.calls.at( - 1 );
		expect( author.kind ).toBe( 'author' );
		expect( author.options ).toMatchObject( { cwd: fixture.config.questsRoot, env: { LLM_BASE_URL: MODEL.baseUrl } } );
		expect( valueAfter( author.args, '--mechanics' ) ).toBe( PLAYABLE_MECHANICS.join( ',' ) );
		expect( valueAfter( author.args, '--profile' ) ).toBe( 'small' );
		expect( valueAfter( author.args, '--world' ) ).toBe( join( fixture.config.outDir, 'drafts/salt-ward/blueprint.json' ) );
		expect( valueAfter( author.args, '--types' ) ).toBe( join( fixture.config.outDir, 'drafts/salt-ward/npc-types.json' ) );
		expect( author.parcels ).toEqual( instances.ids );
		expect( author.prompt ).toBe( 'A courier vanishes on the night shift.\n' );
		expect( author.handoff ).toEqual( { hostCapabilities: HOST_CAPABILITIES } );
		expect( PLAYABLE_MECHANICS ).not.toContain( 'assassinate' );
		const draft = join( fixture.config.outDir, 'drafts/salt-ward' );
		expect( await readJson( join( draft, 'story/recording.json' ) ) ).toMatchObject( { model: 'fixture-model' } );
		expect( await readJson( join( draft, 'quests/quest-bundle.json' ) ) ).toMatchObject( { counts: { questlines: 3 } } );

		const game = await creation.createGame( { cityId: city.id, interiorIds: instances.ids, questId: quests.id } );
		expect( game ).toMatchObject( { quests: [ { totalSteps: 10 } ], sideJobs: [ {}, {} ] } );
		for ( const absent of [ 'story', 'quests/handoff-input.json', 'quests/all.questlines.json' ] ) {

			await expect( readFile( join( fixture.config.outDir, 'games', game.id, absent ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

		}

		// A story the model cannot finish keeps what it said in the draft, beside the story before it.
		fixture.failAuthor = true;
		await expectCode( creation.generateQuests( { cityId: city.id, interiorIds: instances.ids, mainBrief: '', sideJobs: 1 } ), 'E_COMMAND_FAILED' );
		expect( await readJson( join( draft, 'story/meta.json' ) ) ).toMatchObject( { failed: { stage: 'script' } } );
		expect( await readJson( join( draft, 'draft.json' ) ) ).toMatchObject( { questId: quests.id } );
		expect( fixture.calls.at( - 1 ).args.some( ( arg ) => String( arg ).startsWith( '--prompt' ) ) ).toBe( false );

	} );

	it( 'leaves out a side job whose scene cannot stand and fails a main story whose scene cannot', async () => {

		const fixture = await setup();
		const blocked = new Map( [ [ 'side-one', 'scene sc in p0: E_SCENERY_NO_FIT no room for the body' ] ] );
		const checked = [];
		const preflight = { check: async ( world, bundle ) => {

			checked.push( { world, questlines: bundle.questlines.length } );
			return blocked;

		} };
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW, preflight } );
		const city = await creation.generateCity( { name: 'Scene Ward', seed: 'scene', size: 'small' } );
		const { ids } = await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [] } );

		expect( await creation.generateQuests( { cityId: city.id, interiorIds: ids, mainBrief: '', sideJobs: 3 } ) )
			.toEqual( { id: 'scene-ward-quests-2', mainSteps: 10, sideJobs: 2 } );
		expect( checked ).toEqual( [ { world: join( fixture.config.outDir, 'drafts/scene-ward' ), questlines: 4 } ] );
		expect( ( await readJson( join( fixture.config.outDir, 'drafts/scene-ward/quests/questlines.json' ) ) ).map( ( definition ) => definition.id ) )
			.toEqual( [ 'main-line', 'side-two', 'side-three' ] );

		await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [] } );
		blocked.set( 'main-line', 'scene main in p1: E_SCENERY_PLACE p1 floor 0 has no bedroom room' );
		await expectCode( creation.generateQuests( { cityId: city.id, interiorIds: ids, mainBrief: '', sideJobs: 3 } ), 'E_QUEST_LOCATIONS' );

	} );

	async function setup() {

		const root = await mkdtemp( join( tmpdir(), 'urbe-creation-' ) );
		roots.push( root );
		const config = {
			engineRoot: join( root, 'engine' ), atlasRoot: join( root, 'atlas' ), questsRoot: join( root, 'quests' ),
			namingRoot: join( root, 'naming' ), themesDir: THEMES, outDir: join( root, 'engine/out' ), model: MODEL
		};
		await mkdir( join( config.questsRoot, 'creation/fixtures' ), { recursive: true } );
		await writeJson( join( config.questsRoot, 'creation/samples/urbe-small/npc-types.json' ), { contractVersion: '1.0.0', types: [] } );
		const fixture = { config, calls: [], failAuthor: false };
		fixture.run = processPort( fixture );
		return fixture;

	}

} );

function processPort( fixture ) {

	const { calls } = fixture;
	const port = processCommand( fixture );
	return async ( command, args, options = {} ) => {

		const output = await port( command, args, options );
		options.progress?.( `${calls.at( - 1 ).kind} done` );
		return output;

	};

}

function processCommand( fixture ) {

	const { calls } = fixture;
	return async ( command, args, options = {} ) => {

		if ( args[ 0 ] === 'run' && args[ 1 ] === 'generate' ) {

			calls.push( { kind: 'atlas', command, args } );
			await writeJson( valueAfter( args, '--out' ), atlas() );
			return '';

		}
		if ( args[ 0 ] === 'run' && args[ 1 ] === 'world' ) {

			// Naming writes the named blueprint and its people beside the one it read.
			calls.push( { kind: 'naming', command, args, options } );
			const folder = args[ 3 ];
			const plan = await readJson( join( folder, 'blueprint.json' ) );
			await writeJson( join( folder, 'blueprint.named.json' ), {
				...plan, meta: { ...plan.meta, naming: { theme: valueAfter( args, '--theme' ), model: 'fixture-model', namedAt: NOW.toISOString() } },
				parcels: plan.parcels.map( ( parcel ) => ( { ...parcel, name: `Harbour ${parcel.type === 'residential' ? 'Home' : 'Venue'} ${parcel.id}` } ) )
			} );
			await writeJson( join( folder, 'npc-types.json' ), { contractVersion: '1.0.0', types: [ { id: 'dock_hand' } ] } );
			return '';

		}
		if ( args.includes( 'author' ) ) {

			const parcels = await readJson( args.find( ( arg ) => arg.startsWith( '--parcels=@' ) ).slice( 11 ) );
			const prompt = args.find( ( arg ) => arg.startsWith( '--prompt=@' ) );
			calls.push( {
				kind: 'author', command, args, options, parcels, handoff: await readJson( valueAfter( args, '--handoff' ) ),
				prompt: prompt ? await readFile( prompt.slice( 10 ), 'utf8' ) : null
			} );
			const story = valueAfter( args, '--out' );
			if ( fixture.failAuthor ) {

				await writeJson( join( story, 'meta.json' ), { failed: { stage: 'script', message: 'E_LLM unusable script' } } );
				throw new CreationError( 'E_COMMAND_FAILED', 'author failed at script: E_LLM unusable script', 500 );

			}
			await writeJson( join( story, 'recording.json' ), { model: 'fixture-model' } );
			await writeBundle( valueAfter( args, '--questlines' ), [
				quest( 'written-main', 'Written main', 10, parcels.slice( 0, 7 ) ),
				quest( 'written-side-a', 'Written side A', 4, [ parcels[ 7 ] ] ),
				quest( 'written-side-b', 'Written side B', 4, [ parcels[ 8 ] ] )
			] );
			return '';

		}
		if ( args.includes( 'materialize' ) ) {

			calls.push( { kind: 'materialize', command, args } );
			// Output is the fifth positional CLI argument; trailing selection
			// flags must never become filenames in the checkout running the test.
			await writeBundle( args[ args.indexOf( '--' ) + 5 ], definitions() );
			return '';

		}
		if ( args.includes( 'assemble-city' ) ) {

			const world = valueAfter( args, '--out' );
			const source = valueAfter( args, '--blueprint' );
			const blueprint = await readJson( source );
			// The assembler opens an exact manual pick, or an automatic count with
			// the priority parcels first, in their order.
			const priority = args.includes( '--interior-priority' ) ? valueAfter( args, '--interior-priority' ).split( ',' ) : [];
			const selected = args.includes( '--interior-parcels' )
				? valueAfter( args, '--interior-parcels' ).split( ',' )
				: [ ...new Set( [ ...priority, ...blueprint.parcels.map( ( parcel ) => parcel.id ) ] ) ].slice( 0, Number( valueAfter( args, '--interiors' ) ) );
			calls.push( { kind: selected.length ? 'interiors' : 'shells', command, args } );
			await writeJson( join( world, 'blueprint.json' ), blueprint );
			const types = join( dirname( source ), 'npc-types.json' );
			if ( dirname( source ) !== world && await readFile( types ).catch( () => null ) ) await writeJson( join( world, 'npc-types.json' ), await readJson( types ) );
			for ( const parcel of blueprint.parcels ) {

				await writeJson( join( world, parcel.id, `${ parcel.id }.blueprint.json` ), { id: parcel.id } );

			}
			await writeJson( join( world, 'manifest.json' ), {
				contractVersion: '1.0.0', seed: blueprint.seed, atlasVersion: blueprint.version,
				named: blueprint.parcels.some( ( parcel ) => parcel.name ), namingTheme: blueprint.meta?.naming?.theme ?? null,
				parcels: blueprint.parcels.map( ( parcel ) => parcel.id ),
				sources: Object.fromEntries( blueprint.parcels.map( ( parcel ) => [ parcel.id, 'shell' ] ) ),
				interiors: selected, floors: Object.fromEntries( selected.map( ( id ) => [ id, [ '000' ] ] ) )
			} );
			return '';

		}
		throw new Error( `unexpected command: ${ command } ${ args.join( ' ' ) }` );

	};

}

/** Writes a 1.1 bundle as the quests CLIs do: the questlines at `output`, every catalog beside it. */
async function writeBundle( output, questlines ) {

	const objectives = questlines.flatMap( ( definition ) => definition.steps.map( ( step ) => ( {
		questId: definition.id, stepId: step.stepId, action: step.target
	} ) ) );
	const missionAssetRequests = questlines.map( ( definition, index ) => missionRequest( definition.id, index ) );
	const missionItemBindings = questlines.map( ( definition ) => ( {
		questId: definition.id, itemId: `${definition.id}-item`, assetId: `asset.${definition.id}`
	} ) );
	const catalogs = {
		questlines, objectives, investigations: [], mechanicTargetBindings: [], missionAssetRequests,
		missionItemBindings, hostCapabilities: { transportationModes: [] }
	};
	await writeJson( output, questlines );
	await writeJson( join( dirname( output ), 'objectives.json' ), objectives );
	await writeJson( join( dirname( output ), 'investigations.json' ), [] );
	await writeJson( join( dirname( output ), 'mechanic-target-bindings.json' ), [] );
	await writeJson( join( dirname( output ), 'mission-assets.json' ), missionAssetRequests );
	await writeJson( join( dirname( output ), 'mission-item-bindings.json' ), missionItemBindings );
	await writeJson( join( dirname( output ), 'host-capabilities.json' ), catalogs.hostCapabilities );
	await writeJson( join( dirname( output ), 'quest-bundle.json' ), {
		contractVersion: '1.1',
		files: {
			questlines: 'all.questlines.json', objectives: 'objectives.json', investigations: 'investigations.json',
			mechanicTargetBindings: 'mechanic-target-bindings.json', missionAssetRequests: 'mission-assets.json',
			missionItemBindings: 'mission-item-bindings.json', hostCapabilities: 'host-capabilities.json'
		},
		counts: Object.fromEntries( Object.entries( catalogs )
			.filter( ( [ name ] ) => name !== 'hostCapabilities' )
			.map( ( [ name, values ] ) => [ name, values.length ] ) )
	} );
	await writeJson( join( dirname( output ), 'questlines.meta.json' ), { generated: true } );

}

function atlas() {

	return {
		version: '0.14.0', seed: 'fixture', districts: [ { id: 'd0' } ],
		meta: { seed: 'fixture' },
		parcels: parcelIds().map( ( id, index ) => ( {
			id, type: index === 9 ? 'residential' : index % 2 ? 'commerce' : 'clinic',
			access: { point: [ 10 + index * 8, 20 + index * 4 ] }
		} ) )
	};

}

function definitions() {

	return [
		quest( 'main-line', 'Main line', 10, [ 'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6' ] ),
		quest( 'side-one', 'Side one', 5, [ 'p0' ] ),
		quest( 'side-two', 'Side two', 5, [ 'p7' ] ),
		quest( 'side-three', 'Side three', 5, [ 'p8' ] )
	];

}

function quest( id, title, count, locations ) {

	return {
		id, title, premise: `${ title } premise`, items: [ { itemId: `${id}-item` } ],
		steps: Array.from( { length: count }, ( _, index ) => ( {
			stepId: `${ id}-step-${ index + 1 }`,
			narrative: { playerHint: `${ title } objective ${ index + 1 }` },
			target: { parcelId: locations[ index % locations.length ] }
		} ) )
	};

}

function missionRequest( questId, seed ) {

	return {
		contractVersion: '1.0', assetId: `asset.${questId}`, purpose: `Physical item for ${questId}`, family: 'document',
		dimensions: { width: 0.2, height: 0.01, depth: 0.3 },
		materials: [ { slot: 'surface', key: 'cyberpunk/fabric/mid', variantId: 'paper' } ],
		requiredInteractions: [ 'inspect', 'read', 'take' ],
		clearance: { approachDepth: 0.8, sideMargin: 0.2, overhead: 0.1 }, seed
	};

}

function parcelIds() {

	return Array.from( { length: 10 }, ( _, index ) => `p${ index }` );

}

function valueAfter( args, flag ) {

	return args[ args.indexOf( flag ) + 1 ];

}

async function writeJson( path, value ) {

	await mkdir( dirname( path ), { recursive: true } );
	await writeFile( path, JSON.stringify( value, null, 2 ) + '\n' );

}

async function readJson( path ) {

	return JSON.parse( await readFile( path, 'utf8' ) );

}

async function expectCode( promise, code ) {

	try {

		await promise;
		throw new Error( `expected ${ code }` );

	} catch ( error ) {

		expect( error ).toBeInstanceOf( CreationError );
		expect( error.code ).toBe( code );

	}

}
