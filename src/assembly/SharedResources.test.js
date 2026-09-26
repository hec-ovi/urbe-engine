import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collect, dirBytes, markUsed, share, SHARED_DIR, SWEEP_GRACE_MS, sweepLine } from './SharedResources.js';

// Pass-through, so a test can act as another sweep at the moment this one reads or renames.
vi.mock( 'node:fs', async ( importOriginal ) => {

	const actual = await importOriginal();
	return { ...actual, renameSync: vi.fn( actual.renameSync ), statSync: vi.fn( actual.statSync ) };

} );

const previous = process.env.URBE_SHARED_DIR;
let root = null;

beforeEach( () => {

	root = mkdtempSync( join( tmpdir(), 'assembly-gc-' ) );
	process.env.URBE_SHARED_DIR = join( root, 'shared' );

} );

afterEach( () => {

	rmSync( root, { recursive: true, force: true } );
	if ( previous === undefined ) delete process.env.URBE_SHARED_DIR; else process.env.URBE_SHARED_DIR = previous;

} );

it( 'runs every test against a store of its own, never engine/out/shared', () => {

	expect( previous ).toBeTruthy();
	expect( resolve( previous ) ).not.toBe( resolve( SHARED_DIR ) );

} );

it.each( [ 1, 2 ] )( 'keeps preview-only version %s resources alongside legacy city manifests without retaining unrelated sets', version => {

	const citySet = 'interior-modules/1111111111111111';
	const previewModules = 'interior-modules/2222222222222222';
	const previewProps = 'interior-modules/3333333333333333';
	const unreferenced = 'interior-modules/4444444444444444';
	for ( const path of [ citySet, previewModules, previewProps, unreferenced ] ) set( path, { 'modules.json': '{}', 'catalog.json': '{}' } );
	world( 'cities/legacy', { version: '1.0.0', interiorModules: { file: 'modules.json', shared: citySet } } );
	const preview = join( root, 'previews/custom/review' );
	mkdirSync( preview, { recursive: true } );
	writeFileSync( join( preview, 'preview.json' ), JSON.stringify( {
		version, interiorModules: { file: 'modules.json', shared: previewModules },
		interiorProps: { file: 'catalog.json', shared: previewProps },
		// Only the preview's two typed references count; unrelated metadata is not a world manifest.
		kit: { shared: unreferenced }
	} ) );

	const { removed, kept } = collect( root );
	expect( kept.entries.sort() ).toEqual( [ citySet, previewModules, previewProps ] );
	expect( removed.entries ).toEqual( [ unreferenced ] );
	for ( const path of kept.entries ) expect( existsSync( join( root, 'shared', path, 'modules.json' ) ) ).toBe( true );
	expect( existsSync( join( root, 'shared', unreferenced ) ) ).toBe( false );

	// Once the preview itself is removed, its exclusively referenced resources can be reclaimed.
	rmSync( preview, { recursive: true } );
	const next = collect( root );
	expect( next.kept.entries ).toEqual( [ citySet ] );
	expect( next.removed.entries.sort() ).toEqual( [ previewModules, previewProps ] );

} );

/** One set in the store, with the files it holds. */
function set( path, files ) {

	mkdirSync( join( root, 'shared', path ), { recursive: true } );
	for ( const [ name, body ] of Object.entries( files ) ) writeFileSync( join( root, 'shared', path, name ), body );

}

/** One world on disk, which is a folder and the manifest naming what it reads. */
function world( path, manifest ) {

	mkdirSync( join( root, path ), { recursive: true } );
	writeFileSync( join( root, path, 'manifest.json' ), JSON.stringify( manifest ) );

}

it( 'keeps every set the worlds name, their plans among them, and drops the rest', () => {

	set( 'kit/1111111111111111', { 'kit.json': JSON.stringify( { plans: [ {
		glb: 'plans/2222222222222222/tower.glb', blueprint: 'plans/2222222222222222/tower.blueprint.json'
	} ] } ) } );
	set( 'plans/2222222222222222', { 'tower.glb': 'glb', 'tower.blueprint.json': '{}' } );
	set( 'streets-kit/3333333333333333', { 'kit.json': '{}' } );
	set( 'plans/4444444444444444', { 'stale.glb': 'stale' } );

	world( 'cities/one', { kit: { file: 'kit.json', shared: 'kit/1111111111111111' } } );
	world( 'matrix/two/city', { streets: { file: 'streets/manifest.json', sharedKit: 'streets-kit/3333333333333333' } } );

	const { removed, kept } = collect( root );

	expect( kept.entries.sort() ).toEqual( [ 'kit/1111111111111111', 'plans/2222222222222222', 'streets-kit/3333333333333333' ] );
	expect( existsSync( join( root, 'shared', 'plans/2222222222222222', 'tower.glb' ) ) ).toBe( true );
	expect( removed.entries ).toEqual( [ 'plans/4444444444444444' ] );
	expect( existsSync( join( root, 'shared', 'plans/4444444444444444' ) ) ).toBe( false );
	expect( removed.bytes ).toBe( 5 );
	expect( kept.bytes ).toBeGreaterThan( 0 );

} );

/** Ages a store folder, as if a batch last used it `ms` ago. */
function age( path, ms ) {

	const then = new Date( Date.now() - ms );
	utimesSync( join( root, 'shared', path ), then, then );

}

const DAY = 24 * 60 * 60 * 1000;

it( 'lists what a dry run would remove and deletes nothing', () => {

	set( 'plans/1111111111111111', { 'a.glb': 'abc' } );
	set( 'plans/2222222222222222', { 'b.glb': 'b' } );
	world( 'cities/one', { kit: { shared: 'kit/3333333333333333' } } );

	const result = collect( root, [], { dryRun: true } );

	expect( result.removed ).toEqual( { entries: [ 'plans/1111111111111111', 'plans/2222222222222222' ], bytes: 4 } );
	expect( existsSync( join( root, 'shared', 'plans/1111111111111111', 'a.glb' ) ) ).toBe( true );
	expect( sweepLine( result, { dryRun: true } ) ).toMatch( /^shared store: would remove 2 sets/ );

} );

it( 'spares a set a batch used within the grace until a manifest names it, and sweeps it once the grace is over', () => {

	set( 'plans/1111111111111111', { 'drawing.glb': 'fresh' } );
	set( 'plans/2222222222222222', { 'reused.glb': 'old' } );
	set( 'plans/3333333333333333', { 'stale.glb': 'old' } );
	for ( const path of [ 'plans/2222222222222222', 'plans/3333333333333333' ] ) age( path, 2 * DAY );

	// A batch reusing a set marks it; publishing one that stands marks it too.
	expect( markUsed( join( root, 'shared', 'plans/2222222222222222' ) ) ).toBe( true );
	expect( markUsed( join( root, 'shared', 'plans/4444444444444444' ) ) ).toBe( false );
	age( 'plans/3333333333333333', 2 * DAY );
	const source = mkdtempSync( join( root, 'source-' ) );
	expect( share( 'plans', '3333333333333333ffff', source ) ).toBe( 'plans/3333333333333333' );
	expect( existsSync( source ) ).toBe( false );
	expect( Date.now() - statSync( join( root, 'shared', 'plans/3333333333333333' ) ).mtimeMs ).toBeLessThan( DAY );

	const { removed, kept } = collect( root, [], { grace: SWEEP_GRACE_MS } );
	expect( kept.entries.sort() ).toEqual( [ 'plans/1111111111111111', 'plans/2222222222222222', 'plans/3333333333333333' ] );
	expect( removed.entries ).toEqual( [] );

	for ( const path of kept.entries ) age( path, 2 * DAY );
	expect( collect( root, [], { grace: SWEEP_GRACE_MS } ).removed.entries ).toHaveLength( 3 );

} );

it( 'removes nothing when a world or the plan index it names cannot be read, and skips a kit this store does not hold', () => {

	set( 'plans/1111111111111111', { 'a.glb': 'a' } );
	world( 'cities/elsewhere', { kit: { shared: 'kit/9999999999999999' } } );
	mkdirSync( join( root, 'cities/broken' ), { recursive: true } );
	writeFileSync( join( root, 'cities/broken/manifest.json' ), '{"kit":' );

	expect( () => collect( root ) ).toThrow( expect.objectContaining( { code: 'E_SWEEP_UNREADABLE' } ) );
	expect( existsSync( join( root, 'shared', 'plans/1111111111111111' ) ) ).toBe( true );

	rmSync( join( root, 'cities/broken' ), { recursive: true } );
	set( 'kit/2222222222222222', { 'kit.json': '{"plans":' } );
	world( 'cities/corrupt', { kit: { shared: 'kit/2222222222222222' } } );
	expect( () => collect( root ) ).toThrow( expect.objectContaining( { code: 'E_SWEEP_UNREADABLE' } ) );
	expect( existsSync( join( root, 'shared', 'plans/1111111111111111' ) ) ).toBe( true );

	rmSync( join( root, 'cities/corrupt' ), { recursive: true } );
	expect( collect( root ).removed.entries.sort() ).toEqual( [ 'kit/2222222222222222', 'plans/1111111111111111' ] );

} );

it( 'sweeps staging a stopped batch left behind once it is older than the grace', () => {

	set( '.staging/1111111111111111', { 'half.glb': 'half' } );
	set( '.staging/2222222222222222', { 'drawing.glb': 'now' } );
	set( '.staging-abc', { 'furniture.glb': 'furniture' } );
	for ( const path of [ '.staging/1111111111111111', '.staging-abc' ] ) age( path, 2 * DAY );

	const { removed, kept } = collect( root );

	expect( removed.entries.sort() ).toEqual( [ '.staging-abc', '.staging/1111111111111111' ] );
	expect( kept.entries ).toEqual( [] );
	expect( existsSync( join( root, 'shared', '.staging/2222222222222222' ) ) ).toBe( true );

} );

it( 'reports a set it could not delete and carries on with the rest', () => {

	// Only a store another user owns refuses its owner's sweep; root can delete anything.
	if ( process.getuid?.() === 0 ) return;

	set( 'plans/1111111111111111', { 'owned.glb': 'someone else' } );
	set( 'plans/2222222222222222', { 'mine.glb': 'mine' } );
	chmodSync( join( root, 'shared', 'plans/1111111111111111' ), 0o555 );

	try {

		const result = collect( root );

		expect( result.failed.entries ).toEqual( [ 'plans/1111111111111111' ] );
		expect( result.removed.entries ).toEqual( [ 'plans/2222222222222222' ] );
		expect( sweepLine( result ) ).toMatch( /could not remove 1, / );

	} finally { chmodSync( join( root, 'shared', 'plans/1111111111111111' ), 0o755 ); }

} );

it( 'deletes a set only after renaming it out of its name, and finishes a delete a stopped sweep left', () => {

	set( 'plans/1111111111111111', { 'a.glb': 'abc' } );
	// A sweep stopped after the rename: the set is out of its name, its bytes still on disk.
	set( '.swept-plans-2222222222222222-0', { 'b.glb': 'b' } );

	const { removed, kept } = collect( root );

	expect( removed.entries.sort() ).toEqual( [ '.swept-plans-2222222222222222-0', 'plans/1111111111111111' ] );
	expect( removed.bytes ).toBe( 4 );
	expect( kept.entries ).toEqual( [] );
	expect( readdirSync( join( root, 'shared' ) ) ).toEqual( [ 'plans' ] );
	expect( readdirSync( join( root, 'shared', 'plans' ) ) ).toEqual( [] );
	expect( dirBytes( join( root, 'shared', 'plans/1111111111111111' ) ) ).toBe( 0 );

} );

it( 'replaces a set that lost files with a whole drawing, keeps one that stands and drops the drawing', () => {

	const drawing = ( body ) => {

		const source = mkdtempSync( join( root, 'drawing-' ) );
		writeFileSync( join( source, 'plan.glb' ), body );
		writeFileSync( join( source, 'plan.blueprint.json' ), '{}' );
		return source;

	};
	const stands = ( dir ) => [ 'plan.glb', 'plan.blueprint.json' ].every( ( name ) => existsSync( join( dir, name ) ) );
	const at = join( root, 'shared', 'plans/1111111111111111' );

	// Half a set, as a hand or a delete from before sweeps renamed first leaves one.
	set( 'plans/1111111111111111', { 'plan.blueprint.json': '{}' } );
	const first = drawing( 'whole' );
	expect( share( 'plans', '1111111111111111ffff', first, { stands } ) ).toBe( 'plans/1111111111111111' );
	expect( readFileSync( join( at, 'plan.glb' ), 'utf8' ) ).toBe( 'whole' );
	expect( existsSync( first ) ).toBe( false );

	const second = drawing( 'again' );
	share( 'plans', '1111111111111111ffff', second, { stands } );
	expect( readFileSync( join( at, 'plan.glb' ), 'utf8' ) ).toBe( 'whole' );
	expect( existsSync( second ) ).toBe( false );
	expect( readdirSync( join( root, 'shared' ) ) ).toEqual( [ 'plans' ] );

} );

it( 'passes over what another sweep takes while it runs, and throws for none of it', async () => {

	const actual = await vi.importActual( 'node:fs' );
	const shared = ( path ) => join( root, 'shared', path );
	for ( const name of [ '1111111111111111', '2222222222222222', '3333333333333333' ] ) {

		set( `plans/${name}`, { 'plan.glb': 'glb', 'plan.blueprint.json': '{}' } );

	}

	// The other sweep takes 2222 before this one reads its age, 3333 before
	// this one renames it, and one file of 1111 while this one weighs it.
	vi.mocked( fs.statSync ).mockImplementation( ( path, ...rest ) => {

		if ( [ shared( 'plans/2222222222222222' ), shared( 'plans/1111111111111111/plan.glb' ) ].includes( path ) ) rmSync( path, { recursive: true } );
		return actual.statSync( path, ...rest );

	} );
	vi.mocked( fs.renameSync ).mockImplementation( ( from, to ) => {

		if ( from === shared( 'plans/3333333333333333' ) ) rmSync( from, { recursive: true } );
		return actual.renameSync( from, to );

	} );

	try {

		const { removed, kept, failed } = collect( root );

		expect( removed ).toEqual( { entries: [ 'plans/1111111111111111' ], bytes: 2 } );
		expect( kept.entries ).toEqual( [] );
		expect( failed.entries ).toEqual( [] );
		expect( readdirSync( shared( '' ) ) ).toEqual( [ 'plans' ] );
		expect( readdirSync( shared( 'plans' ) ) ).toEqual( [] );

	} finally {

		vi.mocked( fs.statSync ).mockImplementation( actual.statSync );
		vi.mocked( fs.renameSync ).mockImplementation( actual.renameSync );

	}

} );
