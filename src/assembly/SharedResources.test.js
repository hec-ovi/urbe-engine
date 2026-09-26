import { afterEach, beforeEach, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { collect, markUsed, share, SHARED_DIR, SWEEP_GRACE_MS, sweepLine } from './SharedResources.js';

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
	expect( share( 'plans', '3333333333333333ffff', source, { move: true } ) ).toBe( 'plans/3333333333333333' );
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
