import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpLauncherApi } from '../launcher/HttpLauncherApi.js';
import { LauncherService } from './LauncherService.js';
import { launcherRoute } from './launcherRoute.js';

const FIXTURE = fileURLToPath( new URL( '../library/fixtures/out', import.meta.url ) );

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
		const plugin = launcherRoute( root, null, service );
		let handler;
		plugin.configureServer( { middlewares: { use: ( path, callback ) => {

			expect( path ).toBe( '/api/launcher' );
			handler = callback;

		} } } );
		const server = createServer( ( req, res ) => handler( req, res, () => {

			res.statusCode = 404;
			res.end();

		} ) );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		cleanups.push( () => new Promise( ( resolve ) => server.close( resolve ) ) );
		cleanups.push( () => rmSync( root, { recursive: true, force: true } ) );
		const base = `http://127.0.0.1:${server.address().port}`;
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
			npcState,
			investigations
		} );
		expect( saved ).toMatchObject( {
			id: 'night-shift', player: { position: { x: 16, y: 0.12, z: -2 } },
			save: { revision: exported.save.revision + 1, playTimeSeconds: exported.save.playTimeSeconds + 12 },
			transitJourney,
			npcState,
			investigations
		} );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'night-shift', 'game.json' ), 'utf8' ) )
			.transitJourney ).toEqual( transitJourney );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'night-shift', 'game.json' ), 'utf8' ) )
			.npcState ).toEqual( npcState );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'night-shift', 'game.json' ), 'utf8' ) )
			.investigations ).toEqual( investigations );
		await expect( api.saveCurrent( { gameId: 'night-shift' } ) ).rejects.toThrow( 'saveCurrent request is invalid' );

		const imported = { ...exported, id: 'imported-night', name: 'Imported Night', save: { ...exported.save, revision: 5 } };
		const after = await api.importGame( imported );
		expect( after.games.map( ( game ) => game.id ) ).toEqual( [ 'night-shift', 'imported-night' ] );
		expect( JSON.parse( readFileSync( join( outDir, 'games', 'imported-night', 'game.json' ), 'utf8' ) ).save.revision ).toBe( 5 );

	} );

} );
