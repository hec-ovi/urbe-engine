import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createWorldCreation, CreationError } from './index.js';

const NOW = new Date( '2026-09-03T12:30:00Z' );

describe( 'playable world creation contract', () => {

	const roots = [];

	afterEach( async () => {

		await Promise.all( roots.splice( 0 ).map( ( root ) => rm( root, { recursive: true, force: true } ) ) );

	} );

	it( 'publishes the four stages as separate city, draft and playable game artifacts', async () => {

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
		await expect( readFile( join( fixture.config.outDir, 'games/canal-ward/draft.json' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		await expect( readFile( join( bundleDir, 'all.questlines.json' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		await expect( readFile( join( bundleDir, 'questlines.meta.json' ) ) ).rejects.toMatchObject( { code: 'ENOENT' } );
		expect( fixture.calls.map( ( call ) => call.kind ) ).toEqual( [ 'atlas', 'shells', 'materialize', 'interiors' ] );
		expect( fixture.calls[ 0 ] ).toMatchObject( { kind: 'atlas', command: 'npm' } );
		expect( fixture.calls[ 0 ].args.slice( 0, 7 ) ).toEqual( [
			'run', 'generate', '--', '--seed', 'canal-17', '--out', expect.any( String )
		] );
		expect( fixture.calls[ 0 ].args ).toEqual( expect.arrayContaining( [ '--size', '400', '--max-floors', '6', '--no-highways', '--no-trains', '--no-subways' ] ) );

	} );

	it( 'keeps a city shell-only when a later stage rejects invalid input', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		await creation.generateCity( { name: 'Strict City', seed: 'strict', size: 'medium' } );

		await expectCode( creation.generateInstances( {
			cityId: 'strict-city', mode: 'automatic', count: 6, buildingIds: []
		} ), 'E_QUEST_LOCATIONS' );
		await expectCode( creation.generateInstances( {
			cityId: 'strict-city', mode: 'manual', count: 2, buildingIds: [ 'p0' ]
		} ), 'E_INVALID_REQUEST' );
		await expectCode( creation.generateInstances( {
			cityId: 'strict-city', mode: 'manual', count: 1, buildingIds: [ 'missing' ]
		} ), 'E_INVALID_REQUEST' );
		expect( await readJson( join( fixture.config.outDir, 'cities/strict-city/manifest.json' ) ) ).toMatchObject( { interiors: [] } );

	} );

	it( 'fails closed for unsupported story requests and cross-stage mismatches', async () => {

		const fixture = await setup();
		const creation = createWorldCreation( fixture.config, { run: fixture.run, clock: () => NOW } );
		const city = await creation.generateCity( { name: 'Stage City', seed: 'stage', size: 'large' } );
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

	} );

	async function setup() {

		const root = await mkdtemp( join( tmpdir(), 'urbe-creation-' ) );
		roots.push( root );
		const config = {
			engineRoot: join( root, 'engine' ), atlasRoot: join( root, 'atlas' ),
			questsRoot: join( root, 'quests' ), outDir: join( root, 'engine/out' )
		};
		await mkdir( join( config.questsRoot, 'creation/fixtures' ), { recursive: true } );
		await writeJson( join( config.questsRoot, 'creation/fixtures/urbe-cyberpunk.npc-types.json' ), { contractVersion: '1.0.0', types: [] } );
		const calls = [];
		return { config, calls, run: processPort( calls ) };

	}

} );

function processPort( calls ) {

	return async ( command, args ) => {

		if ( args[ 0 ] === 'run' && args[ 1 ] === 'generate' ) {

			calls.push( { kind: 'atlas', command, args } );
			await writeJson( valueAfter( args, '--out' ), atlas() );
			return '';

		}
		if ( args.includes( 'materialize' ) ) {

			calls.push( { kind: 'materialize', command, args } );
			const output = args.at( -1 );
			const questlines = definitions();
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
			return '';

		}
		if ( args.includes( 'assemble-city' ) ) {

			const world = valueAfter( args, '--out' );
			const blueprint = await readJson( valueAfter( args, '--blueprint' ) );
			const selected = args.includes( '--interior-parcels' )
				? valueAfter( args, '--interior-parcels' ).split( ',' )
				: [];
			calls.push( { kind: selected.length ? 'interiors' : 'shells', command, args } );
			await writeJson( join( world, 'blueprint.json' ), blueprint );
			for ( const parcel of blueprint.parcels ) {

				await writeJson( join( world, parcel.id, `${ parcel.id }.blueprint.json` ), { id: parcel.id } );

			}
			await writeJson( join( world, 'manifest.json' ), {
				contractVersion: '1.0.0', seed: blueprint.seed, atlasVersion: blueprint.version,
				named: false, namingTheme: null, parcels: blueprint.parcels.map( ( parcel ) => parcel.id ),
				interiors: selected, floors: Object.fromEntries( selected.map( ( id ) => [ id, [ '000' ] ] ) )
			} );
			return '';

		}
		throw new Error( `unexpected command: ${ command } ${ args.join( ' ' ) }` );

	};

}

function atlas() {

	return {
		version: '0.14.0', seed: 'fixture', districts: [ { id: 'd0' } ],
		parcels: parcelIds().map( ( id, index ) => ( {
			id, type: index % 2 ? 'commerce' : 'clinic',
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
