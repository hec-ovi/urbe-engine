import { afterEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorldCreation, CreationError } from './index.js';
import { HOST_CAPABILITIES } from './src/WorldCreation.js';

const NOW = new Date( '2026-09-03T12:30:00Z' );
/** The fixture city's homes. */
const HOMES = [ 'p3', 'p9' ];
const THEMES = fileURLToPath( new URL( '../../../materials/themes', import.meta.url ) );

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
		// The draft and the game share each file they do not change with the city, one copy on disk.
		const inode = async ( world ) => ( await stat( join( fixture.config.outDir, world, 'p0/p0.blueprint.json' ) ) ).ino;
		expect( await inode( 'drafts/canal-ward' ) ).toBe( await inode( 'cities/canal-ward' ) );
		expect( await inode( 'games/canal-ward' ) ).toBe( await inode( 'cities/canal-ward' ) );
		expect( await readJson( join( fixture.config.outDir, 'cities/canal-ward/manifest.json' ) ) ).toMatchObject( { interiors: [] } );
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
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		await expectCode( creation.generateCity( { size: 'small', theme: 'salt-stained harbour' } ), 'E_INVALID_REQUEST' );
		await expectCode( creation.generateCity( { size: 'small', name: '   ' } ), 'E_INVALID_REQUEST' );
		expect( () => creation.check( 'generateCity', { size: 'tiny' } ) ).toThrow( CreationError );
		expect( () => creation.check( 'catalog', {} ) ).toThrow( 'catalog is no creation stage' );
		expect( () => creation.check( 'importStory', { cityId: 'x', sideJobs: 1 } ) ).toThrow( CreationError );
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
		await expectCode( creation.planCity( { name: 'Strict City', seed: 'strict', size: 'medium' } ), 'E_EXISTS' );
		// A template city cannot take the id of a plan waiting for its build.
		await creation.planCity( { name: 'Held Ward', seed: 'held', size: 'small' } );
		await expectCode( creation.generateCity( { name: 'Held Ward', seed: 'held', size: 'small' } ), 'E_EXISTS' );
		expect( await readJson( join( fixture.config.outDir, 'plans/held-ward/plan.json' ) ) ).toMatchObject( { id: 'held-ward' } );
		await expectCode( creation.buildCity( { cityId: 'strict-city' } ), 'E_PLAN_NOT_FOUND' );
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
		await expectCode( creation.importStory( { cityId: city.id, recording: 'nowhere', sideJobs: 1 } ), 'E_INVALID_REQUEST' );
		await expectCode( creation.importStory( { cityId: city.id, recording: fixture.recording, sideJobs: 4 } ), 'E_SIDE_JOB_LIMIT' );
		await expectCode( creation.createGame( {
			cityId: city.id, interiorIds: instances.ids, questId: 'not-the-stage'
		} ), 'E_STAGE_MISMATCH' );
		await expectCode( creation.createGame( {
			cityId: city.id, interiorIds: [ 'p1' ], questId: null
		} ), 'E_STAGE_MISMATCH' );

		expect( await readJson( join( fixture.config.outDir, 'cities/strict-city/manifest.json' ) ) ).toMatchObject( { interiors: [] } );
		// Creation runs Atlas, the assembler and Quests' replay, and nothing that writes.
		expect( new Set( fixture.calls.map( ( call ) => call.kind ) ) ).toEqual( new Set( [ 'atlas', 'shells', 'materialize', 'interiors' ] ) );

	} );

	it( 'plans a city, builds it from the plan as an author named it and plays a story written outside the engine', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );

		const told = [];
		const plan = await creation.planCity( { name: 'Salt Ward', seed: 'salt-3', size: 'small' }, { progress: ( line ) => told.push( line ) } );
		expect( told ).toEqual( [ 'atlas done' ] );
		const planDir = join( fixture.config.outDir, 'plans/salt-ward' );
		expect( plan ).toMatchObject( {
			id: 'salt-ward', name: 'Salt Ward', size: 'small', seed: 'salt-3', plannedAt: NOW.toISOString(),
			blueprint: { uri: 'blueprint.json', mediaType: 'application/json' }, stats: { population: 120 }
		} );
		expect( await readJson( join( planDir, 'plan.json' ) ) ).toEqual( plan );
		expect( fixture.calls.map( ( call ) => call.kind ) ).toEqual( [ 'atlas' ] );
		await expectCode( creation.planCity( { name: 'Salt Ward', seed: 'other', size: 'small' } ), 'E_EXISTS' );
		await expect( creation.library.loadCity( { id: 'salt-ward' } ) ).rejects.toMatchObject( { code: 'E_CITY_NOT_FOUND' } );

		// An author names the plan outside the engine, as the Naming box writes it.
		const atlasPlan = await readJson( join( planDir, 'blueprint.json' ) );
		const named = namedWorld( atlasPlan, 'salt-stained harbour' );
		const authoring = join( fixture.root, 'authoring' );
		await writeJson( join( authoring, 'blueprint.named.json' ), named );
		await writeJson( join( authoring, 'npc-types.json' ), { contractVersion: '1.0.0', types: [ { type: 'dock_hand' } ] } );
		const namedBytes = await readFile( join( authoring, 'blueprint.named.json' ) );
		// Paths resolve against the engine checkout.
		const paths = { blueprint: '../authoring/blueprint.named.json', types: '../authoring/npc-types.json' };

		await writeJson( join( authoring, 'other.named.json' ), { ...named, districts: [ { id: 'd9' } ] } );
		await expectCode( creation.buildCity( { cityId: plan.id, named: { ...paths, blueprint: '../authoring/other.named.json' } } ), 'E_STAGE_MISMATCH' );
		await writeJson( join( authoring, 'themeless.named.json' ), { ...named, meta: { seed: 'fixture' } } );
		await expectCode( creation.buildCity( { cityId: plan.id, named: { ...paths, blueprint: '../authoring/themeless.named.json' } } ), 'E_INVALID_REQUEST' );
		await expectCode( creation.buildCity( { cityId: plan.id, named: { ...paths, types: '../authoring/missing.json' } } ), 'E_INVALID_REQUEST' );

		// What the author wrote beside the plan outlives it, in the city.
		await writeJson( join( planDir, 'businesses.json' ), [ { brandName: 'Salt Line', businessKind: 'commerce', tier: 'mid' } ] );
		await writeJson( join( planDir, 'author/naming-districts-1.json' ), { charter: {} } );
		const city = await creation.buildCity( { cityId: plan.id, named: paths } );
		// The world is built from the named blueprint's own bytes, which it binds.
		const shells = fixture.calls.at( - 1 );
		expect( shells.kind ).toBe( 'shells' );
		expect( shells.source ).toEqual( namedBytes );
		expect( city ).toMatchObject( { id: 'salt-ward', name: 'Salt Ward', seed: 'salt-3', size: 'small' } );
		expect( city.buildings.find( ( building ) => building.id === 'p9' ) ).toMatchObject( { label: 'Harbour Home p9', type: 'residential' } );
		const cityDir = join( fixture.config.outDir, 'cities/salt-ward' );
		expect( await readJson( join( cityDir, 'npc-types.json' ) ) ).toMatchObject( { types: [ { type: 'dock_hand' } ] } );
		expect( await readJson( join( cityDir, 'manifest.json' ) ) ).toMatchObject( { named: true, namingTheme: 'salt-stained harbour' } );
		await expect( lstat( planDir ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		expect( await readJson( join( cityDir, 'naming/businesses.json' ) ) ).toEqual( [ { brandName: 'Salt Line', businessKind: 'commerce', tier: 'mid' } ] );
		expect( await readJson( join( cityDir, 'naming/author/naming-districts-1.json' ) ) ).toEqual( { charter: {} } );
		for ( const planned of [ 'plan.json', 'blueprint.json' ] ) {

			await expect( lstat( join( cityDir, 'naming', planned ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

		}
		await expectCode( creation.buildCity( { cityId: plan.id } ), 'E_PLAN_NOT_FOUND' );

		// A named city opens the buildings asked for first, then a home and a spread of the kinds that hire.
		const instances = await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [ 'p4' ] } );
		const opened = fixture.calls.at( - 1 );
		expect( opened.kind ).toBe( 'interiors' );
		const priority = valueAfter( opened.args, '--interior-priority' ).split( ',' );
		expect( priority[ 0 ] ).toBe( 'p4' );
		expect( HOMES ).toContain( priority[ 1 ] );
		expect( instances.ids.slice( 0, 2 ) ).toEqual( priority.slice( 0, 2 ) );
		expect( fixture.calls.map( ( call ) => call.kind ) ).not.toContain( 'materialize' );
		// The draft holds what a story's author records against, the game's capabilities among it.
		expect( await readJson( join( fixture.config.outDir, 'drafts/salt-ward/quests/handoff-input.json' ) ) ).toEqual( { hostCapabilities: HOST_CAPABILITIES } );
		await expectCode( creation.generateQuests( { cityId: city.id, interiorIds: instances.ids, mainBrief: '', sideJobs: 1 } ), 'E_STAGE_MISMATCH' );

		const quests = await creation.importStory( { cityId: city.id, recording: '../authoring/story', sideJobs: 3 } );
		expect( quests ).toEqual( { id: 'salt-ward-story-2', mainSteps: 10, sideJobs: 2 } );
		const replay = fixture.calls.at( - 1 );
		expect( replay.kind ).toBe( 'materialize' );
		const draft = join( fixture.config.outDir, 'drafts/salt-ward' );
		expect( replay.args.slice( 3, 8 ) ).toEqual( [
			join( fixture.root, 'authoring/story/recording.json' ), 'small', join( draft, 'blueprint.json' ), join( draft, 'npc-types.json' ),
			expect.stringMatching( /quests\/all\.questlines\.json$/ )
		] );
		expect( replay.args.at( - 1 ) ).toBe( `--parcels=${instances.ids.join( ',' )}` );
		expect( replay.handoff ).toEqual( { hostCapabilities: HOST_CAPABILITIES } );
		// The draft keeps what the story was made from and what it left out.
		expect( await readJson( join( draft, 'story/recording.json' ) ) ).toMatchObject( { fixture: 'written' } );
		expect( await readFile( join( draft, 'story/script.md' ), 'utf8' ) ).toBe( '# The Salt Line\n' );
		expect( await readJson( join( draft, 'story/meta.json' ) ) ).toMatchObject( { profile: 'small', bundle: {} } );
		expect( await readJson( join( draft, 'story/left-out.json' ) ) ).toEqual( [
			{ questId: 'written-side-c', reason: 'has steps the game does not play: assassinate' }
		] );
		await expect( readFile( join( draft, 'story/world.json' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		expect( ( await readJson( join( draft, 'quests/questlines.json' ) ) ).map( ( definition ) => definition.id ) )
			.toEqual( [ 'written-main', 'written-side-a', 'written-side-b' ] );

		const game = await creation.createGame( { cityId: city.id, interiorIds: instances.ids, questId: quests.id } );
		expect( game ).toMatchObject( { quests: [ { id: 'written-main', totalSteps: 10 } ], sideJobs: [ {}, {} ] } );
		for ( const absent of [ 'naming', 'story', 'quests/handoff-input.json', 'quests/all.questlines.json', 'draft.json' ] ) {

			await expect( lstat( join( fixture.config.outDir, 'games', game.id, absent ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

		}
		expect( new Set( fixture.calls.map( ( call ) => call.kind ) ) ).toEqual( new Set( [ 'atlas', 'shells', 'interiors', 'materialize' ] ) );

		// A main story with a step the game cannot play is refused, leaving the draft's story as it was.
		await writeJson( join( authoring, 'unplayable/recording.json' ), { fixture: 'unplayable' } );
		await expectCode( creation.importStory( { cityId: city.id, recording: '../authoring/unplayable', sideJobs: 0 } ), 'E_INVALID_REQUEST' );
		// An author run's story is finished only with its bundle, and casts its people with the city's size.
		for ( const [ name, meta ] of [
			[ 'unfinished', { profile: 'small', needs: [ { stage: 'script', file: 'script.md' } ] } ],
			[ 'failed', { profile: 'small', failed: { stage: 'script', message: 'no title' } } ],
			[ 'elsewhere', { profile: 'author', bundle: { path: 'bundle/questlines.json' } } ]
		] ) {

			await writeJson( join( authoring, name, 'recording.json' ), { fixture: 'written' } );
			await writeJson( join( authoring, name, 'meta.json' ), meta );
			await expectCode( creation.importStory( { cityId: city.id, recording: `../authoring/${name}`, sideJobs: 0 } ), 'E_INVALID_REQUEST' );

		}
		expect( await readJson( join( draft, 'draft.json' ) ) ).toMatchObject( { questId: quests.id } );
		expect( fixture.calls.filter( ( call ) => call.kind === 'materialize' ) ).toHaveLength( 2 );

	} );

	it( 'hands Atlas the district range asked for, records it in the plan and refuses a plan made without it', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		for ( const input of [
			{ districtCount: [ 5, 4 ] }, { districtCount: [ 0, 4 ] }, { districtCount: [ 4, 13 ] }, { districtCount: [ 4 ] },
			{ districtCount: [ 4.5, 5 ] }, { hydrology: { type: 'sea-coast' } }
		] ) expect( () => creation.check( 'planCity', { size: 'medium', ...input } ), JSON.stringify( input ) ).toThrow( CreationError );
		await expectCode( creation.planCity( { size: 'medium', districtCount: [ 5, 4 ] } ), 'E_INVALID_REQUEST' );

		const asked = { districtCount: [ 4, 5 ] };
		const plan = await creation.planCity( { name: 'Tide Ward', seed: 'tide-1', size: 'medium', ...asked } );
		expect( fixture.calls[ 0 ].args.slice( 7 ) ).toEqual( [ '--size', '1000', '--district-count', '4,5' ] );
		expect( plan ).toMatchObject( { id: 'tide-ward', seed: 'tide-1', ...asked } );
		expect( await readJson( join( fixture.config.outDir, 'plans/tide-ward/plan.json' ) ) ).toEqual( plan );
		await creation.buildCity( { cityId: plan.id } );
		expect( ( await readJson( join( fixture.config.outDir, 'cities/tide-ward/blueprint.json' ) ) ).meta.params ).toMatchObject( asked );

		// Omitted, Atlas gets today's command and the plan records nothing more.
		const bare = await creation.planCity( { name: 'Bare Tide', seed: 'bare', size: 'small' } );
		expect( fixture.calls.at( - 1 ).args.slice( 7 ) ).toEqual( [ '--size', '500' ] );
		expect( bare ).not.toHaveProperty( 'districtCount' );
		expect( bare ).not.toHaveProperty( 'features' );

		fixture.olderAtlas = true;
		await expectCode( creation.generateCity( { name: 'Old Tide', size: 'medium', districtCount: [ 4, 5 ] } ), 'E_OUTPUT_INVALID' );
		await expectCode( creation.planCity( { name: 'Old Tide', size: 'medium', districtCount: [ 4, 5 ] } ), 'E_OUTPUT_INVALID' );
		await expect( lstat( join( fixture.config.outDir, 'plans/old-tide' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		await expect( lstat( join( fixture.config.outDir, 'cities/old-tide' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

	} );

	it( 'turns off the Atlas features asked for, records them in the plan and refuses a plan that kept one', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		for ( const input of [ { features: {} }, { features: { trains: false } }, { features: { highways: 'no' } } ] ) {

			expect( () => creation.check( 'planCity', { size: 'small', ...input } ), JSON.stringify( input ) ).toThrow( CreationError );

		}

		const asked = { features: { highways: false, alleys: true } };
		const plan = await creation.planCity( { name: 'Open Sky', seed: 'sky', size: 'small', ...asked } );
		expect( fixture.calls[ 0 ].args.slice( 7 ) ).toEqual( [ '--size', '500', '--no-highways' ] );
		expect( plan ).toMatchObject( { id: 'open-sky', ...asked } );
		expect( await readJson( join( fixture.config.outDir, 'plans/open-sky/plan.json' ) ) ).toEqual( plan );

		await creation.generateCity( { name: 'Low Town', size: 'small', features: { alleys: false, subways: false, highways: false } } );
		expect( fixture.calls.filter( ( call ) => call.kind === 'atlas' ).at( - 1 ).args.slice( 7 ) ).toEqual( [
			'--size', '500', '--no-highways', '--no-subways', '--no-alleys'
		] );

		fixture.olderAtlas = true;
		await expectCode( creation.planCity( { name: 'Old Sky', size: 'small', features: { highways: false } } ), 'E_OUTPUT_INVALID' );
		await expect( lstat( join( fixture.config.outDir, 'plans/old-sky' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

	} );

	it( 'builds an unnamed plan into the city the template makes', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		const plan = await creation.planCity( { name: 'Bare Ward', seed: 'bare', size: 'medium' } );
		// A folder beside the plan holds no people the build would take up.
		await writeJson( join( fixture.config.outDir, 'plans/bare-ward/npc-types.json' ), { types: [ { type: 'stray' } ] } );
		const planned = await readFile( join( fixture.config.outDir, 'plans/bare-ward/blueprint.json' ) );
		await writeFile( join( fixture.config.outDir, 'plans/bare-ward/blueprint.json' ), '{}' );
		await expectCode( creation.buildCity( { cityId: plan.id } ), 'E_STAGE_MISMATCH' );
		await writeFile( join( fixture.config.outDir, 'plans/bare-ward/blueprint.json' ), planned );

		const city = await creation.buildCity( { cityId: plan.id } );
		expect( city ).toMatchObject( { id: 'bare-ward', seed: 'bare', size: 'medium' } );
		const cityDir = join( fixture.config.outDir, 'cities/bare-ward' );
		expect( await readJson( join( cityDir, 'manifest.json' ) ) ).toMatchObject( { named: false } );
		await expect( readFile( join( cityDir, 'npc-types.json' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		expect( await readJson( join( cityDir, 'naming/npc-types.json' ) ) ).toEqual( { types: [ { type: 'stray' } ] } );

		// A plan with nothing beside it leaves nothing behind.
		const clean = await creation.planCity( { name: 'Clean Ward', seed: 'clean', size: 'small' } );
		await creation.buildCity( { cityId: clean.id } );
		await expect( lstat( join( fixture.config.outDir, 'cities/clean-ward/naming' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		await expect( lstat( join( fixture.config.outDir, 'plans/clean-ward' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );

	} );

	it( 'opens a home in a named city when its first home cannot be furnished, and fails a pick that opens none', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		const plan = await creation.planCity( { name: 'Home Ward', seed: 'home', size: 'small' } );
		// The author names the plan in its own folder, where the Naming CLI writes beside the blueprint.
		const planDir = join( fixture.config.outDir, 'plans/home-ward' );
		await writeJson( join( planDir, 'blueprint.named.json' ), namedWorld( await readJson( join( planDir, 'blueprint.json' ) ), 'tidal flats' ) );
		await writeJson( join( planDir, 'npc-types.json' ), { contractVersion: '1.0.0', types: [ { type: 'tide_keeper' } ] } );
		const city = await creation.buildCity( { cityId: plan.id, named: {
			blueprint: 'out/plans/home-ward/blueprint.named.json', types: 'out/plans/home-ward/npc-types.json'
		} } );
		expect( await readJson( join( fixture.config.outDir, 'cities/home-ward/naming/npc-types.json' ) ) ).toMatchObject( { types: [ { type: 'tide_keeper' } ] } );

		// Six other buildings asked for first leave the first home the count's last place,
		// and the next home waits right after it, for the place of any building that does not open.
		const pick = { cityId: city.id, mode: 'automatic', count: 7, buildingIds: [ 'p0', 'p1', 'p2', 'p4', 'p6', 'p7' ] };
		const opened = await creation.generateInstances( pick );
		const priority = valueAfter( fixture.calls.at( - 1 ).args, '--interior-priority' ).split( ',' );
		const [ first, next ] = priority.filter( ( id ) => HOMES.includes( id ) );
		expect( priority.slice( 0, 8 ) ).toEqual( [ ...pick.buildingIds, first, next ] );
		expect( opened.ids ).toEqual( [ ...pick.buildingIds, first ] );
		fixture.unfurnishable.add( first );
		expect( ( await creation.generateInstances( pick ) ).ids ).toEqual( [ ...pick.buildingIds, next ] );

		fixture.unfurnishable.add( next );
		await expectCode( creation.generateInstances( pick ), 'E_QUEST_LOCATIONS' );
		expect( ( await readJson( join( fixture.config.outDir, 'drafts/home-ward/draft.json' ) ) ).interiorIds ).toEqual( [ ...pick.buildingIds, next ] );

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
		expect( await readJson( join( fixture.config.outDir, 'drafts/scene-ward/story/left-out.json' ) ) )
			.toEqual( [ { questId: 'side-one', reason: blocked.get( 'side-one' ) } ] );

		await creation.generateInstances( { cityId: city.id, mode: 'automatic', count: 9, buildingIds: [] } );
		blocked.set( 'main-line', 'scene main in p1: E_SCENERY_PLACE p1 floor 0 has no bedroom room' );
		await expectCode( creation.generateQuests( { cityId: city.id, interiorIds: ids, mainBrief: '', sideJobs: 3 } ), 'E_QUEST_LOCATIONS' );

	} );

	async function setup() {

		const root = await mkdtemp( join( tmpdir(), 'urbe-creation-' ) );
		roots.push( root );
		const config = {
			engineRoot: join( root, 'engine' ), atlasRoot: join( root, 'atlas' ), questsRoot: join( root, 'quests' ),
			themesDir: THEMES, outDir: join( root, 'engine/out' )
		};
		const sample = join( config.questsRoot, 'creation/samples/urbe-small' );
		await writeJson( join( sample, 'npc-types.json' ), { contractVersion: '1.0.0', types: [] } );
		await writeJson( join( sample, 'recording.json' ), { model: 'recorded' } );
		// A story an author wrote outside the engine, as Quests records one.
		const story = join( root, 'authoring/story' );
		await writeJson( join( story, 'recording.json' ), { fixture: 'written' } );
		await writeFile( join( story, 'script.md' ), '# The Salt Line\n' );
		await writeJson( join( story, 'meta.json' ), { profile: 'small', bundle: { path: 'bundle/questlines.json', questlines: 4 } } );
		await writeJson( join( story, 'world.json' ), { meta: {} } );
		const fixture = { root, config, calls: [], recording: '../authoring/story', unfurnishable: new Set() };
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
			// An Atlas older than the flags plans without them.
			await writeJson( valueAfter( args, '--out' ), atlas( fixture.olderAtlas ? undefined : planParams( args ) ) );
			return '';

		}
		if ( args.includes( 'materialize' ) ) {

			// Positional after `--`: recording, profile, world, types, output, handoff.
			const at = args.indexOf( '--' );
			const recording = await readJson( args[ at + 1 ] );
			const parcels = args.find( ( arg ) => arg.startsWith( '--parcels=' ) )?.slice( 10 ).split( ',' ) ?? parcelIds();
			calls.push( { kind: 'materialize', command, args, handoff: await readJson( args[ at + 6 ] ) } );
			// Trailing selection flags must never become filenames in the checkout running the test.
			await writeBundle( args[ at + 5 ], recording.fixture === 'written' ? written( parcels )
				: recording.fixture === 'unplayable' ? [ quest( 'lethal-main', 'Lethal main', 8, parcels.slice( 0, 7 ), 'assassinate' ) ]
					: definitions() );
			return '';

		}
		if ( args.includes( 'assemble-city' ) ) {

			const world = valueAfter( args, '--out' );
			const source = valueAfter( args, '--blueprint' );
			const blueprint = await readJson( source );
			// The assembler opens an exact manual pick, or an automatic count with
			// the priority parcels first, in their order, where a building
			// Interior cannot furnish gives its place to the next.
			const priority = args.includes( '--interior-priority' ) ? valueAfter( args, '--interior-priority' ).split( ',' ) : [];
			const selected = args.includes( '--interior-parcels' )
				? valueAfter( args, '--interior-parcels' ).split( ',' )
				: [ ...new Set( [ ...priority, ...blueprint.parcels.map( ( parcel ) => parcel.id ) ] ) ]
					.filter( ( id ) => ! fixture.unfurnishable.has( id ) ).slice( 0, Number( valueAfter( args, '--interiors' ) ) );
			calls.push( { kind: selected.length ? 'interiors' : 'shells', command, args, source: await readFile( source ) } );
			// Like the assembler, it writes beside a name and renames over it, and keeps every shell it reuses.
			await publishJson( join( world, 'blueprint.json' ), blueprint );
			const types = join( dirname( source ), 'npc-types.json' );
			if ( dirname( source ) !== world && await readFile( types ).catch( () => null ) ) await publishJson( join( world, 'npc-types.json' ), await readJson( types ) );
			if ( ! args.includes( '--reuse-shells' ) ) {

				for ( const parcel of blueprint.parcels ) await publishJson( join( world, parcel.id, `${ parcel.id }.blueprint.json` ), { id: parcel.id } );

			}
			await publishJson( join( world, 'manifest.json' ), {
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

/** The fixture plan; `params` is what Atlas records in `meta.params` for the flags it was given. */
function atlas( params ) {

	return {
		version: '0.14.0', seed: 'fixture', districts: [ { id: 'd0' } ],
		meta: { seed: 'fixture', ...( params && { params } ) }, stats: { population: 120, parcelCounts: {}, perDistrict: [] },
		parcels: parcelIds().map( ( id, index ) => ( {
			id, type: HOMES.includes( id ) ? 'residential' : index % 2 ? 'commerce' : 'clinic',
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

/** The story the author wrote: a main line over seven opened buildings, three side jobs, one with a step the game does not play. */
function written( parcels ) {

	return [
		quest( 'written-main', 'Written main', 10, parcels.slice( 0, 7 ) ),
		quest( 'written-side-a', 'Written side A', 4, [ parcels[ 7 ] ] ),
		quest( 'written-side-c', 'Written side C', 4, [ parcels[ 8 ] ], 'assassinate' ),
		quest( 'written-side-b', 'Written side B', 4, [ parcels[ 8 ] ] )
	];

}

/** The plan as the Naming box names it: every parcel named, the naming recorded, nothing else touched. */
function namedWorld( plan, theme ) {

	return {
		...plan, meta: { ...plan.meta, naming: { theme, model: 'external author', namedAt: NOW.toISOString() } },
		parcels: plan.parcels.map( ( parcel ) => ( { ...parcel, name: `Harbour ${parcel.type === 'residential' ? 'Home' : 'Venue'} ${parcel.id}` } ) )
	};

}

function quest( id, title, count, locations, lastKind = 'goto' ) {

	return {
		id, title, premise: `${ title } premise`, items: [ { itemId: `${id}-item` } ],
		steps: Array.from( { length: count }, ( _, index ) => ( {
			stepId: `${ id}-step-${ index + 1 }`,
			narrative: { playerHint: `${ title } objective ${ index + 1 }` },
			target: { kind: index === count - 1 ? lastKind : 'goto', parcelId: locations[ index % locations.length ] }
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

/** The Atlas parameters its flags stand for, as Atlas resolves them: every feature toggle, a district range only when given one. */
function planParams( args ) {

	return {
		...( args.includes( '--district-count' ) && { districtCount: valueAfter( args, '--district-count' ).split( ',' ).map( Number ) } ),
		features: Object.fromEntries( [ 'highways', 'subways', 'alleys' ].map( ( feature ) => [ feature, ! args.includes( `--no-${feature}` ) ] ) )
	};

}

function valueAfter( args, flag ) {

	return args[ args.indexOf( flag ) + 1 ];

}

async function writeJson( path, value ) {

	await mkdir( dirname( path ), { recursive: true } );
	await writeFile( path, JSON.stringify( value, null, 2 ) + '\n' );

}

async function publishJson( path, value ) {

	await writeJson( `${path}.next`, value );
	await rename( `${path}.next`, path );

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
