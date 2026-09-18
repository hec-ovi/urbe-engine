import { afterAll, beforeAll, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect } from './SharedResources.js';

const previous = process.env.URBE_SHARED_DIR;
let root = null;

beforeAll( () => {

	root = mkdtempSync( join( tmpdir(), 'assembly-gc-' ) );
	process.env.URBE_SHARED_DIR = join( root, 'shared' );

} );

afterAll( () => {

	rmSync( root, { recursive: true, force: true } );
	if ( previous === undefined ) delete process.env.URBE_SHARED_DIR; else process.env.URBE_SHARED_DIR = previous;

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
