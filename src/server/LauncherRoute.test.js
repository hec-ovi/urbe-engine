import { afterEach, describe, expect, it, vi } from 'vitest';
import AjvModule from 'ajv/dist/2020.js';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpLauncherApi } from '../launcher/HttpLauncherApi.js';
import { CreationError } from '../creation/index.js';
import { CREATION_METHODS, CreationJobs } from './CreationJobs.js';
import { LauncherService } from './LauncherService.js';
import { launcherRoute } from './launcherRoute.js';
import { GamePersistence } from '../game/persistence/index.js';
import { DESCRIPTOR_SCHEMAS } from '../library/src/DescriptorSchemas.js';
import persistenceValues from '../game/persistence/schema/values.schema.json' with { type: 'json' };
import saveCurrentPayload from '../game/persistence/schema/save-current-payload.schema.json' with { type: 'json' };

const FIXTURE = fileURLToPath( new URL( '../library/fixtures/out', import.meta.url ) );
const Ajv2020 = AjvModule.default ?? AjvModule;
const schemaAt = ( path ) => JSON.parse( readFileSync( new URL( path, import.meta.url ), 'utf8' ) );
const validateJob = new Ajv2020( { strict: true } ).compile( schemaAt( './schema/creation-job.schema.json' ) );

describe( 'launcher HTTP boundary', () => {

	const cleanups = [];

	afterEach( async () => {

		for ( const cleanup of cleanups.splice( 0 ) ) await cleanup();

	} );

	it( 'lists, opens, exports and imports through the real route and filesystem library', async () => {

		const root = mkdtempSync( join( tmpdir(), 'urbe-launcher-route-' ) );
		const outDir = join( root, 'out' );
		cpSync( FIXTURE, outDir, { recursive: true } );
		const service = new LauncherService( { outDir } );
		const base = await serve( launcherRoute( root, null, service ) );
		cleanups.push( () => rmSync( root, { recursive: true, force: true } ) );
		const api = new HttpLauncherApi( ( url, options ) => fetch( base + url, options ) );

		const catalog = await api.catalog();
		expect( catalog.cities.map( ( city ) => city.id ) ).toEqual( [ 'large', 'small' ] );
		expect( catalog.games[ 0 ] ).toMatchObject( {
			id: 'night-shift', cityName: 'Small Urbe', location: 'Market Two', position: [ 12, 0.12, -4 ]
		} );
		expect( await api.continueGame( 'night-shift' ) ).toEqual( {
			playUrl: '/?mode=game&game=night-shift&out=%2Fout%2Fgames%2Fnight-shift'
		} );

		const exported = await api.exportGame( 'night-shift' );
		const transitJourney = {
			status: 'waiting', clock: { dayOffset: 86400, lastDaySeconds: 120 }
		};
		const questTransit = {
			questId: 'main', stepId: 'escape', stage: 'arrival',
			tripId: 'trip-live', routeId: 'route-live', passengerNpcId: 'npc.witness'
		};
		const npcState = {
			timeMin: 1562,
			simulation: { version: '1', seed: 'small-urbe', events: [] },
			continuity: { version: '1', actors: [], follow: null, conversation: null }
		};
		const investigations = [ {
			contractVersion: '1.0', sceneId: 'scene-apartment-47', revision: 1,
			evidence: [ { evidenceId: 'body-position', status: 'discovered' } ],
			emittedTransitionIds: [ 'unlock-blood-reading' ]
		} ];
		const scenery = [ { contractVersion: '1.0', sceneId: 'courier-found', status: 'retired', stagedAtMin: 1500, retiredAtMin: 1550 } ];
		const dialogueMemory = [ { npcId: 'npc.witness', memory: { digest: [], turns: [ { speaker: 'npc', text: 'Not here.', atMin: 1561 } ] } } ];
		const saved = await api.saveCurrent( {
			gameId: exported.id,
			expectedRevision: exported.save.revision,
			updatedAt: '2026-09-03T12:00:00Z',
			playTimeSeconds: exported.save.playTimeSeconds + 12,
			player: { ...exported.player, position: { x: 16, y: 0.12, z: -2 } },
			quests: exported.quests,
			sideJobs: exported.sideJobs,
			currentLocation: exported.currentLocation,
			discoveredLocations: exported.discoveredLocations,
			transitJourney,
			questTransit,
			npcState,
			investigations,
			scenery,
			dialogueMemory
		} );
		expect( saved ).toMatchObject( {
			id: 'night-shift', player: { position: { x: 16, y: 0.12, z: -2 } },
			save: { revision: exported.save.revision + 1, playTimeSeconds: exported.save.playTimeSeconds + 12 },
			transitJourney,
			questTransit,
			npcState,
			investigations,
			scenery,
			dialogueMemory
		} );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'night-shift', 'game.json' ), 'utf8' ) ) )
			.toMatchObject( { transitJourney, questTransit, npcState, investigations, scenery, dialogueMemory } );
		// A later save that leaves them out keeps them.
		const kept = await api.saveCurrent( {
			gameId: saved.id, expectedRevision: saved.save.revision, updatedAt: '2026-09-03T12:05:00Z',
			playTimeSeconds: saved.save.playTimeSeconds + 1, player: saved.player, quests: saved.quests, sideJobs: saved.sideJobs,
			currentLocation: saved.currentLocation, discoveredLocations: saved.discoveredLocations
		} );
		expect( kept ).toMatchObject( { investigations, scenery, dialogueMemory } );
		await expect( api.saveCurrent( { gameId: 'night-shift' } ) ).rejects.toThrow( 'saveCurrent request is invalid' );

		const imported = { ...exported, id: 'imported-night', name: 'Imported Night', save: { ...exported.save, revision: 5 } };
		const after = await api.importGame( imported );
		expect( after.games.map( ( game ) => game.id ) ).toEqual( [ 'night-shift', 'imported-night' ] );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'imported-night', 'game.json' ), 'utf8' ) ).save.revision ).toBe( 5 );


		const free = { ...exported, id: 'free-play', questBundle: null, selectedInteriors: [], quests: [], sideJobs: [] };
		await api.importGame( free );
		const persistence = new GamePersistence( {
			game: await api.exportGame( free.id ), gameId: free.id,
			fetcher: ( url, options ) => fetch( base + url, options ),
			now: () => new Date( '2026-09-06T12:00:00Z' )
		} );
		await persistence.save( {
			position: { x: 22, y: 0.2, z: -8 }, heading: 1.2, inventory: [],
			quests: [], sideJobs: [], currentLocation: free.currentLocation,
			discoveredLocations: free.discoveredLocations, elapsedSeconds: 20
		} );
		const resumed = await api.exportGame( free.id );
		expect( resumed ).toMatchObject( {
			questBundle: null, quests: [], sideJobs: [], selectedInteriors: [],
			player: { position: { x: 22, y: 0.2, z: -8 }, heading: 1.2 },
			save: { revision: free.save.revision + 1, playTimeSeconds: free.save.playTimeSeconds + 20 }
		} );
		expect( ( await api.continueGame( free.id ) ).playUrl ).toContain( 'game=free-play' );

	} );

	it( 'queues creation stages as jobs that run in submission order and keep their result or error', async () => {

		const order = [];
		let release;
		const held = new Promise( ( resolve ) => release = resolve );
		const creation = {
			check( method, input ) {

				if ( method.endsWith( 'City' ) && method !== 'buildCity' && ! input?.size ) throw new CreationError( 'E_INVALID_REQUEST', '/ must have required property size' );

			},
			async generateCity( input, { progress } ) {

				order.push( input.name );
				progress( `planning ${input.name}` );
				if ( input.name === 'first' ) await held;
				if ( input.name === 'broken' ) throw new CreationError( 'E_COMMAND_FAILED', 'atlas exited 1', 500 );
				return { id: input.name, name: input.name, size: input.size, seed: 's', buildings: [], districtCount: 1 };

			},
			planCity: async ( input ) => ( { id: 'planned', size: input.size } ),
			buildCity: async ( input ) => ( { id: input.cityId, name: 'Planned', size: 'small', seed: 's', buildings: [], districtCount: 1 } ),
			importStory: async ( input ) => ( { id: `${input.cityId}-story-1`, mainSteps: 8, sideJobs: 1 } )
		};
		const outDir = mkdtempSync( join( tmpdir(), 'urbe-jobs-' ) );
		cleanups.push( () => rmSync( outDir, { recursive: true, force: true } ) );
		const service = new LauncherService( { outDir, creation } );
		service.catalog = async () => ( { games: [], cities: [] } );
		const base = await serve( launcherRoute( '/unused', creation, service, new CreationJobs( { service, creation, maxPending: 2 } ) ) );
		const post = async ( body ) => {

			const response = await fetch( `${base}/api/creation-jobs`, { method: 'POST', body: JSON.stringify( body ) } );
			return { status: response.status, body: await response.json() };

		};
		const read = async ( id ) => ( await fetch( `${base}/api/creation-jobs/${id}` ) ).json();

		const first = await post( { method: 'generateCity', input: { size: 'small', name: 'first' } } );
		expect( first.status ).toBe( 202 );
		expect( first.body ).toMatchObject( { method: 'generateCity', state: 'queued', progress: null, result: null, error: null } );
		const second = await post( { method: 'generateCity', input: { size: 'small', name: 'broken' } } );
		expect( ( await post( { method: 'generateCity', input: { size: 'small', name: 'third' } } ) ).body.code ).toBe( 'E_BUSY' );
		expect( await post( { method: 'generateCity', input: {} } ) ).toMatchObject( { status: 400, body: { code: 'E_INVALID_REQUEST' } } );
		expect( await post( { method: 'catalog' } ) ).toMatchObject( { status: 400, body: { code: 'E_INVALID_REQUEST' } } );
		expect( await read( first.body.id ) ).toMatchObject( { state: 'running', progress: 'planning first' } );
		expect( await read( second.body.id ) ).toMatchObject( { state: 'queued' } );

		release();
		await vi.waitFor( async () => expect( ( await read( second.body.id ) ).state ).toBe( 'failed' ) );
		expect( order ).toEqual( [ 'first', 'broken' ] );
		expect( await read( first.body.id ) ).toMatchObject( {
			state: 'succeeded', result: { city: { id: 'first', status: 'ready' }, catalog: { games: [], cities: [] } }
		} );
		expect( await read( second.body.id ) ).toMatchObject( { error: { code: 'E_COMMAND_FAILED', message: 'atlas exited 1' }, result: null } );
		const missing = await fetch( `${base}/api/creation-jobs/creation-00000000-0000-0000-0000-000000000000` );
		expect( [ missing.status, ( await missing.json() ).code ] ).toEqual( [ 404, 'E_JOB_NOT_FOUND' ] );

		// The external authoring stages answer as their launcher methods do.
		const settled = async ( body ) => {

			const { id } = ( await post( body ) ).body;
			await vi.waitFor( async () => expect( ( await read( id ) ).state ).toBe( 'succeeded' ) );
			return read( id );

		};
		expect( ( await settled( { method: 'planCity', input: { size: 'small' } } ) ).result ).toEqual( { plan: { id: 'planned', size: 'small' } } );
		const built = await settled( { method: 'buildCity', input: { cityId: 'planned' } } );
		expect( built ).toMatchObject( { method: 'buildCity', result: { city: { id: 'planned', status: 'ready' }, catalog: { games: [], cities: [] } } } );
		expect( validateJob( built ) ).toBe( true );
		expect( ( await settled( { method: 'importStory', input: { cityId: 'planned', recording: 'story', sideJobs: 1 } } ) ).result )
			.toEqual( { quests: { id: 'planned-story-1', mainSteps: 8, sideJobs: 1 } } );

	} );

	it( 'declares every creation stage in the launcher request and creation job schemas', () => {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of [ ...DESCRIPTOR_SCHEMAS, persistenceValues, saveCurrentPayload ] ) ajv.addSchema( schema );
		for ( const path of [
			'../library/schema/city-descriptor.schema.json', '../library/schema/game-descriptor.schema.json',
			...[ 'generate-city', 'build-city', 'generate-instances', 'generate-quests', 'import-story', 'create-game' ]
				.map( ( name ) => `../creation/schema/${name}.schema.json` )
		] ) ajv.addSchema( schemaAt( path ) );
		const request = ajv.compile( schemaAt( './schema/launcher-request.schema.json' ) );

		expect( schemaAt( './schema/creation-job.schema.json' ).properties.method.enum ).toEqual( [ ...CREATION_METHODS ] );
		for ( const body of [
			{ method: 'planCity', input: { size: 'small', seed: 'harbour' } },
			{ method: 'buildCity', input: { cityId: 'harbour', named: { blueprint: 'out/plans/harbour/blueprint.named.json', types: 'out/plans/harbour/npc-types.json' } } },
			{ method: 'buildCity', input: { cityId: 'harbour' } },
			{ method: 'importStory', input: { cityId: 'harbour', recording: '../quests/creation/samples/urbe-small', sideJobs: 2 } }
		] ) expect( request( body ), JSON.stringify( request.errors ) ).toBe( true );
		for ( const body of [
			{ method: 'generateCity', input: { size: 'small', theme: 'harbour' } },
			{ method: 'buildCity', input: { cityId: 'harbour', named: { blueprint: 'a.json' } } },
			{ method: 'importStory', input: { cityId: 'harbour', sideJobs: 2 } }
		] ) expect( request( body ) ).toBe( false );

	} );

	/** Mounts the plugin's middlewares by prefix on a loopback server, as Vite does. @returns its base URL */
	async function serve( plugin ) {

		const routes = [];
		plugin.configureServer( { middlewares: { use: ( path, callback ) => routes.push( [ path, callback ] ) } } );
		const server = createServer( ( req, res ) => {

			const [ prefix, handler ] = routes.find( ( [ path ] ) => req.url.startsWith( path ) ) ?? [];
			const missing = () => { res.statusCode = 404; res.end(); };
			if ( ! handler ) return missing();
			req.url = req.url.slice( prefix.length ) || '/';
			handler( req, res, missing );

		} );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		cleanups.push( () => new Promise( ( resolve ) => server.close( resolve ) ) );
		return `http://127.0.0.1:${server.address().port}`;

	}

} );
