import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const DAY = 24 * 60 * 60 * 1000;

let root = null;
let store = null;

beforeEach( () => {

	root = mkdtempSync( join( tmpdir(), 'urbe-gc-cli-' ) );
	store = join( root, 'shared' );

} );

afterEach( () => rmSync( root, { recursive: true, force: true } ) );

/** How `npm run gc` runs against this test's store. */
const gc = ( ...args ) => spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/gc-cli.js', ...args ],
	{ cwd: ENGINE_ROOT, encoding: 'utf8', env: { ...process.env, URBE_SHARED_DIR: store } } );

/** One set in the store, last used `ms` ago. */
function set( path, ms = 0 ) {

	mkdirSync( join( store, path ), { recursive: true } );
	writeFileSync( join( store, path, 'plan.glb' ), 'glb' );
	const then = new Date( Date.now() - ms );
	utimesSync( join( store, path ), then, then );

}

/** A world outside engine/out that reads this store. */
function world( name, manifest ) {

	mkdirSync( join( root, 'worlds', name ), { recursive: true } );
	writeFileSync( join( root, 'worlds', name, 'manifest.json' ), manifest );

}

describe( 'npm run gc', () => {

	it( 'refuses a flag it does not know and a grace that is no number of hours', () => {

		for ( const args of [ [ '--now' ], [ '--grace', '-1' ], [ '--grace', 'day' ], [ '--grace', '' ], [ 'shared' ] ] ) {

			const run = gc( ...args );
			expect( run.status, args.join( ' ' ) ).toBe( 2 );
			expect( run.stderr ).toMatch( /usage: npm run gc/ );

		}

	}, 30_000 );

	it( 'spares what a batch used within a day unless told otherwise, and lists a dry run without deleting', () => {

		set( 'plans/1111111111111111', 2 * DAY );
		set( 'plans/2222222222222222' );
		set( 'plans/3333333333333333', 2 * DAY );
		world( 'one', JSON.stringify( { kit: { shared: 'kit/4444444444444444' } } ) );
		mkdirSync( join( store, 'kit/4444444444444444' ), { recursive: true } );
		writeFileSync( join( store, 'kit/4444444444444444/kit.json' ), JSON.stringify( { plans: [ { glb: 'plans/3333333333333333/plan.glb' } ] } ) );
		const worlds = [ '--worlds', join( root, 'worlds' ) ];

		const dry = gc( '--dry-run', ...worlds );
		expect( dry.status, dry.stderr ).toBe( 0 );
		expect( dry.stdout ).toMatch( /^would remove plans\/1111111111111111$/m );
		expect( dry.stdout ).toMatch( /shared store: would remove 1 sets, 0\.0 MB; kept 3/ );
		expect( existsSync( join( store, 'plans/1111111111111111/plan.glb' ) ) ).toBe( true );

		const swept = gc( ...worlds );
		expect( swept.status, swept.stderr ).toBe( 0 );
		expect( swept.stdout ).toMatch( /^removed plans\/1111111111111111$/m );
		expect( readdirSync( join( store, 'plans' ) ).sort() ).toEqual( [ '2222222222222222', '3333333333333333' ] );

		// Nothing builds: every set no world names goes, whenever it was used.
		const now = gc( '--grace', '0', ...worlds );
		expect( now.status, now.stderr ).toBe( 0 );
		expect( now.stdout ).toMatch( /^removed plans\/2222222222222222$/m );
		expect( readdirSync( join( store, 'plans' ) ) ).toEqual( [ '3333333333333333' ] );
		expect( existsSync( join( store, 'kit/4444444444444444/kit.json' ) ) ).toBe( true );

	}, 30_000 );

	it( 'exits 1 and removes nothing when a world cannot be read', () => {

		set( 'plans/1111111111111111', 2 * DAY );
		world( 'broken', '{"kit":' );

		const run = gc( '--grace', '0', '--worlds', join( root, 'worlds' ) );

		expect( run.status ).toBe( 1 );
		expect( run.stderr ).toMatch( /^E_SWEEP_UNREADABLE: .*manifest\.json cannot be read/m );
		expect( existsSync( join( store, 'plans/1111111111111111/plan.glb' ) ) ).toBe( true );

	}, 20_000 );

} );
