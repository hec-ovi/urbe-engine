import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLibrary, LibraryError } from '../index.js';

const FIXTURE = fileURLToPath( new URL( '../fixtures/out', import.meta.url ) );

describe( 'city and game library contract', () => {

	const roots = [];

	afterEach( () => {

		for ( const root of roots.splice( 0 ) ) rmSync( root, { recursive: true, force: true } );

	} );

	it( 'discovers direct city and game directories in stable id order', async () => {

		const outDir = fixtureOut();
		writeFileSync( join( outDir, 'cities', 'README.txt' ), 'ignored non-directory' );
		mkdirSync( join( outDir, 'cities', 'small', 'buildings', 'nested-city' ), { recursive: true } );
		writeFileSync( join( outDir, 'cities', 'small', 'buildings', 'nested-city', 'city.json' ), '{}' );
		const library = createLibrary( { outDir } );

		const catalog = await library.discover();

		expect( catalog.contractVersion ).toBe( '1.0.0' );
		expect( catalog.cities.map( ( city ) => city.id ) ).toEqual( [ 'large', 'small' ] );
		expect( catalog.games.map( ( game ) => game.id ) ).toEqual( [ 'night-shift' ] );
		expect( ( await library.listCities() ).items ).toEqual( catalog.cities );
		expect( ( await library.listGames() ).items ).toEqual( catalog.games );
		expect( await library.loadCity( { id: 'small' } ) ).toEqual( catalog.cities[ 1 ] );
		expect( await library.loadGame( { id: 'night-shift' } ) ).toEqual( catalog.games[ 0 ] );
		expect( catalog.games[ 0 ] ).toMatchObject( {
			currentLocation: { id: 'p2', name: 'Market Two' },
			player: { inventory: [ { id: 'access-card', name: 'Access Card' } ] }
		} );

	} );

	it( 'returns empty catalogs when the output roots do not exist', async () => {

		const outDir = temporaryOut();
		const catalog = await createLibrary( { outDir } ).discover( {} );

		expect( catalog ).toEqual( { contractVersion: '1.0.0', cities: [], games: [] } );

	} );

	it( 'saves canonical JSON and advances only the expected revision', async () => {

		const firstOut = fixtureOut();
		const secondOut = fixtureOut();
		const first = createLibrary( { outDir: firstOut } );
		const second = createLibrary( { outDir: secondOut } );
		const game = savedGame();

		const created = await first.saveGame( { game, expectedRevision: null } );
		await second.saveGame( { game: reverseObjectKeys( game ), expectedRevision: null } );
		const firstText = readFileSync( join( firstOut, 'games', 'fresh-save', 'game.json' ), 'utf8' );
		const secondText = readFileSync( join( secondOut, 'games', 'fresh-save', 'game.json' ), 'utf8' );

		expect( created ).toEqual( { contractVersion: '1.0.0', created: true, game } );
		expect( firstText ).toBe( secondText );
		expect( firstText.endsWith( '\n' ) ).toBe( true );
		expect( firstText.indexOf( '"cityId"' ) ).toBeLessThan( firstText.indexOf( '"contractVersion"' ) );

		const updated = {
			...game,
			player: { ...game.player, position: { x: 14, y: 0.12, z: -4 } },
			save: { ...game.save, revision: 2, updatedAt: '2026-09-02T21:00:00Z', playTimeSeconds: 1900 }
		};
		expect( await first.saveGame( { game: updated, expectedRevision: 1 } ) ).toEqual( {
			contractVersion: '1.0.0', created: false, game: updated
		} );
		await expectError( first.saveGame( { game: { ...updated, save: { ...updated.save, revision: 3 } }, expectedRevision: 1 } ), 'E_REVISION_CONFLICT' );
		await expectError( first.saveGame( {
			game: { ...updated, selectedInteriors: [ 'p7' ], save: { ...updated.save, revision: 3 } }, expectedRevision: 2
		} ), 'E_INVALID_REQUEST' );

	} );

	it( 'publishes a city descriptor once into an existing artifact directory', async () => {

		const outDir = temporaryOut();
		const directory = join( outDir, 'cities', 'medium' );
		mkdirSync( directory, { recursive: true } );
		writeFileSync( join( directory, 'manifest.json' ), '{}' );
		writeFileSync( join( directory, 'blueprint.json' ), '{}' );
		const source = JSON.parse( readFileSync( join( FIXTURE, 'cities', 'small', 'city.json' ), 'utf8' ) );
		const city = { ...source, id: 'medium', name: 'Medium Urbe', size: 'medium' };
		const library = createLibrary( { outDir } );

		expect( await library.saveCity( city ) ).toEqual( {
			contractVersion: '1.0.0', created: true, city
		} );
		expect( await library.loadCity( { id: 'medium' } ) ).toEqual( city );
		await expectError( library.saveCity( city ), 'E_EXISTS' );
		await expectError( library.saveCity( { ...city, id: 'bad-date', generatedAt: '2026-02-31T12:00:00Z' } ), 'E_INVALID_REQUEST' );
		await expectError( library.saveCity( {
			...city, id: 'duplicate-buildings', buildings: [ city.buildings[ 0 ], city.buildings[ 0 ] ]
		} ), 'E_INVALID_REQUEST' );

	} );

	it( 'fails closed for invalid requests, missing records and unsafe ids', async () => {

		const library = createLibrary( { outDir: fixtureOut() } );

		expectSyncError( () => createLibrary( { outDir: '', extra: true } ), 'E_INVALID_REQUEST' );
		await expectError( library.loadCity( {} ), 'E_INVALID_REQUEST' );
		await expectError( library.loadCity( { id: '../small' } ), 'E_INVALID_ID' );
		await expectError( library.loadCity( { id: 'missing' } ), 'E_CITY_NOT_FOUND' );
		await expectError( library.loadGame( { id: 'missing' } ), 'E_GAME_NOT_FOUND' );
		await expectError( library.saveGame( { game: savedGame() } ), 'E_INVALID_REQUEST' );

	} );

	it( 'reports storage roots that are not directories', async () => {

		const outDir = temporaryOut();
		writeFileSync( outDir, 'not a directory' );
		await expectError( createLibrary( { outDir } ).listCities(), 'E_STORAGE' );

	} );

	it( 'rejects malformed descriptors and dangling game content', async () => {

		const outDir = fixtureOut();
		const library = createLibrary( { outDir } );
		const gamePath = join( outDir, 'games', 'night-shift', 'game.json' );
		writeFileSync( gamePath, '{' );
		await expectError( library.loadGame( { id: 'night-shift' } ), 'E_INVALID_DESCRIPTOR' );

		writeJson( gamePath, { ...savedGame(), id: 'night-shift', cityId: 'missing' } );
		await expectError( library.loadGame( { id: 'night-shift' } ), 'E_REFERENCE_NOT_FOUND' );

		writeJson( gamePath, {
			...savedGame(), id: 'night-shift', selectedInteriors: [ 'unknown-interior' ]
		} );
		await expectError( library.loadGame( { id: 'night-shift' } ), 'E_INVALID_DESCRIPTOR' );

		const cityPath = join( outDir, 'cities', 'small', 'city.json' );
		const city = JSON.parse( readFileSync( cityPath, 'utf8' ) );
		writeJson( cityPath, { ...city, buildings: city.buildings.map( ( building ) => ( {
			...building, eligible: building.id === 'p2' ? false : building.eligible
		} ) ) } );
		writeJson( gamePath, { ...savedGame(), id: 'night-shift' } );
		await expectError( library.loadGame( { id: 'night-shift' } ), 'E_INVALID_DESCRIPTOR' );

	} );

	it( 'rejects resource traversal and symbolic-link descriptor paths', async () => {

		const outDir = fixtureOut();
		const cityPath = join( outDir, 'cities', 'small', 'city.json' );
		const city = JSON.parse( readFileSync( cityPath, 'utf8' ) );
		city.world.manifest.uri = '../manifest.json';
		writeJson( cityPath, city );
		await expectError( createLibrary( { outDir } ).loadCity( { id: 'small' } ), 'E_UNSAFE_PATH' );

		rmSync( join( outDir, 'cities', 'large' ), { recursive: true } );
		symlinkSync( join( outDir, 'cities', 'small' ), join( outDir, 'cities', 'large' ) );
		await expectError( createLibrary( { outDir } ).loadCity( { id: 'large' } ), 'E_UNSAFE_PATH' );

	} );

	function fixtureOut() {

		const outDir = temporaryOut();
		cpSync( FIXTURE, outDir, { recursive: true } );
		return outDir;

	}

	function temporaryOut() {

		const root = mkdtempSync( join( tmpdir(), 'urbe-library-' ) );
		roots.push( root );
		return join( root, 'out' );

	}

} );

function savedGame() {

	return {
		contractVersion: '1.0.0',
		id: 'fresh-save',
		name: 'Fresh Save',
		cityId: 'small',
		size: 'small',
		selectedInteriors: [ 'p2' ],
		questBundle: null,
		quests: [],
		sideJobs: [],
		player: {
			position: { x: 12, y: 0.12, z: -4 },
			heading: 1.5,
			inventory: []
		},
		currentLocation: { id: 'p2', name: 'Market Two' },
		discoveredLocations: [ { id: 'p2', name: 'Market Two' } ],
		save: {
			revision: 1,
			createdAt: '2026-09-02T20:00:00Z',
			updatedAt: '2026-09-02T20:30:00Z',
			playTimeSeconds: 1800
		}
	};

}

function reverseObjectKeys( value ) {

	if ( Array.isArray( value ) ) return value.map( reverseObjectKeys );
	if ( value === null || typeof value !== 'object' ) return value;
	return Object.fromEntries( Object.entries( value ).reverse().map( ( [ key, child ] ) => [ key, reverseObjectKeys( child ) ] ) );

}

function writeJson( path, value ) {

	mkdirSync( dirname( path ), { recursive: true } );
	writeFileSync( path, JSON.stringify( value ) );

}

async function expectError( promise, code ) {

	try {

		await promise;
		throw new Error( `expected ${code}` );

	} catch ( error ) {

		expect( error ).toBeInstanceOf( LibraryError );
		expect( error.code ).toBe( code );
		expect( error.toJSON() ).toMatchObject( { code, message: expect.any( String ) } );

	}

}

function expectSyncError( action, code ) {

	try {

		action();
		throw new Error( `expected ${code}` );

	} catch ( error ) {

		expect( error ).toBeInstanceOf( LibraryError );
		expect( error.code ).toBe( code );

	}

}
