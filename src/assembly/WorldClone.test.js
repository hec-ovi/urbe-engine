import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cloneWorld, linkUnchanged } from './WorldClone.js';
import { replaceFile, writeJsonFile } from './JsonFile.js';
import { OutDir } from './OutDir.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
let root = null;

afterEach( () => {

	if ( root ) rmSync( root, { recursive: true, force: true } );
	root = null;

} );

/** A small world: documents at the top, one parcel with its shell, one furnished building. */
function world() {

	root = mkdtempSync( join( tmpdir(), 'urbe-clone-' ) );
	const city = join( root, 'cities', 'one' );
	mkdirSync( join( city, 'p1', 'interior', 'layouts' ), { recursive: true } );
	writeFileSync( join( city, 'manifest.json' ), '{"parcels":["p1"]}\n' );
	writeFileSync( join( city, 'blueprint.json' ), '{"parcels":[]}\n' );
	writeFileSync( join( city, 'npc-types.json' ), '{"types":[]}\n' );
	writeFileSync( join( city, 'p1', 'p1.glb' ), 'shell bytes' );
	writeFileSync( join( city, 'p1', 'p1.blueprint.json' ), '{"floors":[]}\n' );
	writeFileSync( join( city, 'p1', 'interior', 'layouts', 'ground.json' ), '{"id":"ground"}\n' );
	symlinkSync( 'p1/p1.glb', join( city, 'shell.glb' ) );

	return city;

}

/** Every file under a folder with its bytes, by path. */
function contents( dir, prefix = '' ) {

	return Object.fromEntries( readdirSync( dir, { withFileTypes: true } ).flatMap( ( entry ) => {

		const path = join( dir, entry.name );
		if ( entry.isDirectory() ) return Object.entries( contents( path, `${prefix}${entry.name}/` ) );
		return [ [ `${prefix}${entry.name}`, entry.isSymbolicLink() ? `-> ${readlinkSync( path )}` : readFileSync( path, 'utf8' ) ] ];

	} ) );

}

describe( 'cloneWorld', () => {

	it( 'gives the clone every file of the source as a hard link, in folders of its own', async () => {

		const city = world();
		const draft = join( root, 'drafts', 'one' );
		mkdirSync( join( root, 'drafts' ) );

		await cloneWorld( city, draft );

		expect( contents( draft ) ).toEqual( contents( city ) );
		for ( const file of [ 'manifest.json', 'p1/p1.glb', 'p1/interior/layouts/ground.json' ] ) {

			expect( statSync( join( draft, file ) ).ino ).toBe( statSync( join( city, file ) ).ino );
			expect( statSync( join( draft, file ) ).nlink ).toBe( 2 );

		}
		expect( statSync( join( draft, 'p1' ) ).ino ).not.toBe( statSync( join( city, 'p1' ) ).ino );
		expect( readlinkSync( join( draft, 'shell.glb' ) ) ).toBe( 'p1/p1.glb' );
		await expect( cloneWorld( city, draft ) ).rejects.toMatchObject( { code: 'EEXIST' } );

	} );

	it( 'keeps every world apart when one of them writes, furnishes or goes', async () => {

		const city = world();
		const draft = join( root, 'draft' );
		const game = join( root, 'game' );
		await cloneWorld( city, draft );
		const before = contents( city );

		// The draft's writers: documents, a regenerated shell, a carried NPC set, a replaced interior.
		writeJsonFile( join( draft, 'blueprint.json' ), { parcels: [ 'p1' ] } );
		replaceFile( join( draft, 'p1', 'p1.glb' ), 'regenerated shell' );
		writeFileSync( join( root, 'npc-types.json' ), '{"types":["named"]}\n' );
		new OutDir( draft ).carryTypes( join( root, 'blueprint.json' ) );
		rmSync( join( draft, 'p1', 'interior' ), { recursive: true } );
		mkdirSync( join( draft, 'p1', 'interior' ) );
		writeFileSync( join( draft, 'p1', 'interior', 'building.json' ), '{}\n' );

		expect( contents( city ) ).toEqual( before );
		expect( readFileSync( join( draft, 'p1', 'p1.glb' ), 'utf8' ) ).toBe( 'regenerated shell' );
		expect( readFileSync( join( draft, 'npc-types.json' ), 'utf8' ) ).toBe( '{"types":["named"]}\n' );
		// What the draft did not write it still shares.
		expect( statSync( join( draft, 'p1', 'p1.blueprint.json' ) ).ino ).toBe( statSync( join( city, 'p1', 'p1.blueprint.json' ) ).ino );

		// A game from the draft shares the draft's own files and the city's untouched ones.
		await cloneWorld( draft, game );
		replaceFile( join( game, 'manifest.json' ), '{"parcels":[],"game":true}\n' );
		expect( readFileSync( join( draft, 'manifest.json' ), 'utf8' ) ).toBe( before[ 'manifest.json' ] );
		expect( statSync( join( game, 'p1', 'p1.glb' ) ).ino ).toBe( statSync( join( draft, 'p1', 'p1.glb' ) ).ino );

		// Removing the draft leaves the city and the game whole.
		const game0 = contents( game );
		rmSync( draft, { recursive: true } );
		expect( contents( city ) ).toEqual( before );
		expect( contents( game ) ).toEqual( game0 );

	} );

	it( 'leaves a game as it was when quests are carried into the draft it was cloned from', async () => {

		const draft = world();
		const game = join( root, 'game' );
		const run = join( root, 'run' );
		mkdirSync( join( draft, 'quests' ) );
		writeFileSync( join( draft, 'quests', 'questlines.json' ), '[{"id":"draft story"}]\n' );
		mkdirSync( run );
		writeFileSync( join( run, 'main.questline.json' ), JSON.stringify( { definition: { id: 'new story' } } ) );
		await cloneWorld( draft, game );
		const before = contents( game );

		const carried = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/quests-cli.js', '--from', run, '--out', draft ],
			{ cwd: ENGINE_ROOT, encoding: 'utf8' } );

		expect( carried.status, carried.stderr ).toBe( 0 );
		expect( JSON.parse( readFileSync( join( draft, 'quests', 'questlines.json' ), 'utf8' ) ) ).toEqual( [ { id: 'new story' } ] );
		expect( contents( game ) ).toEqual( before );

	}, 20_000 );

	it( 'copies a file it cannot link, as across filesystems', async () => {

		const city = world();
		const copy = join( root, 'copy' );
		const unlinkable = () => Promise.reject( Object.assign( new Error( 'cross-device link' ), { code: 'EXDEV' } ) );

		await cloneWorld( city, copy, { link: unlinkable } );

		expect( contents( copy ) ).toEqual( contents( city ) );
		expect( statSync( join( copy, 'p1', 'p1.glb' ) ).ino ).not.toBe( statSync( join( city, 'p1', 'p1.glb' ) ).ino );
		const denied = () => Promise.reject( Object.assign( new Error( 'no space' ), { code: 'ENOSPC' } ) );
		await expect( cloneWorld( city, join( root, 'full' ), { link: denied } ) ).rejects.toMatchObject( { code: 'ENOSPC' } );

	} );

} );

describe( 'linkUnchanged', () => {

	it( 'links every staged file whose bytes did not change to the file it replaces, and leaves the rest its own', () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-unchanged-' ) );
		const published = join( root, 'streets' );
		const staged = join( root, 'stage', 'streets' );
		for ( const dir of [ published, staged ] ) mkdirSync( join( dir, 'parts' ), { recursive: true } );
		for ( const [ name, old, fresh ] of [
			[ 'manifest.json', 'same', 'same' ], [ 'placements.json', 'old', 'new' ],
			[ 'parts/0.json', 'part', 'part' ], [ 'parts/1.json', 'one', 'two' ]
		] ) {

			writeFileSync( join( published, name ), old );
			writeFileSync( join( staged, name ), fresh );

		}
		writeFileSync( join( staged, 'added.json' ), 'added' );
		mkdirSync( join( published, 'kind.json' ) );
		writeFileSync( join( staged, 'kind.json' ), 'was a folder' );

		linkUnchanged( staged, published );

		const same = ( name ) => statSync( join( staged, name ) ).ino === statSync( join( published, name ) ).ino;
		expect( [ 'manifest.json', 'parts/0.json' ].every( same ) ).toBe( true );
		expect( [ 'placements.json', 'parts/1.json', 'kind.json' ].some( same ) ).toBe( false );
		expect( readFileSync( join( staged, 'placements.json' ), 'utf8' ) ).toBe( 'new' );
		expect( readdirSync( staged ).sort() ).toEqual( [ 'added.json', 'kind.json', 'manifest.json', 'parts', 'placements.json' ] );

	} );

} );

describe( 'replaceFile and writeJsonFile', () => {

	it( 'replace a name whole, leaving a linked copy and nothing pending behind', () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-replace-' ) );
		const file = join( root, 'doc.json' );
		const peer = join( root, 'peer.json' );
		writeFileSync( file, 'old\n' );
		linkSync( file, peer );

		writeJsonFile( file, { a: [ 1, 'two' ] } );
		expect( readFileSync( file, 'utf8' ) ).toBe( '{"a":[1,"two"]}\n' );
		replaceFile( peer, Buffer.from( 'peer\n' ) );
		expect( readFileSync( file, 'utf8' ) ).toBe( '{"a":[1,"two"]}\n' );
		expect( readFileSync( peer, 'utf8' ) ).toBe( 'peer\n' );

		// A name that cannot be replaced keeps what it held and leaves no pending file.
		mkdirSync( join( root, 'folder.json' ) );
		expect( () => replaceFile( join( root, 'folder.json' ), 'x' ) ).toThrow();
		expect( () => writeJsonFile( join( root, 'missing', 'doc.json' ), {} ) ).toThrow();
		expect( readdirSync( root ).sort() ).toEqual( [ 'doc.json', 'folder.json', 'peer.json' ] );
		expect( existsSync( join( root, 'missing' ) ) ).toBe( false );

	} );

} );
