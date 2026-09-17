import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import atlas from './native-city.fixture.json';
import { OutDir } from './OutDir.js';
import { sha256 } from './JsonFile.js';
import { StreetsAhead } from './StreetsAhead.js';

let directory;
afterEach( () => { if ( directory ) rmSync( directory, { recursive: true, force: true } ); } );

it( 'publishes native streets bound to exact staged blueprint and manifest bytes', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-' ) );
	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true } );
	const blueprintBytes = readFileSync( join( directory, 'blueprint.json' ) );
	const streetBytes = readFileSync( join( directory, manifest.streets.file ) );
	const streets = JSON.parse( streetBytes );
	expect( manifest.streets ).toEqual( { file: 'streets/manifest.json', sha256: sha256( streetBytes ), blueprintSha256: sha256( blueprintBytes ) } );
	expect( streets.meta ).toMatchObject( { architectureVersion: '0.23.0', blueprintEncoding: 'json-file-bytes', blueprintHash: manifest.streets.blueprintSha256 } );
	expect( JSON.parse( blueprintBytes ) ).toEqual( atlas );
	for ( const piece of streets.pieces ) expect( sha256( readFileSync( join( directory, 'streets', piece.asset ) ) ) ).toBe( piece.sha256 );
	expect( streets ).not.toHaveProperty( 'assets' );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

	const before = [ 'blueprint.json', 'manifest.json', 'streets/manifest.json' ].map( name => readFileSync( join( directory, name ) ) );
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: { nativeMaterials: join( directory, 'missing.json' ) } } ) ).rejects.toMatchObject( { code: 'E_STREETS_BUILD' } );
	for ( const [ index, name ] of [ 'blueprint.json', 'manifest.json', 'streets/manifest.json' ].entries() ) expect( readFileSync( join( directory, name ) ) ).toEqual( before[ index ] );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

} );

it( 'rejects archive-native publication before creating staging artifacts', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-archive-' ) );
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { encoding: 'archive', streets: true } ) ).rejects.toMatchObject( { code: 'E_STREETS_ARCHIVE_UNSUPPORTED' } );
	expect( readdirSync( directory ) ).toEqual( [] );

} );

it( 'adopts an ahead-of-time streets build and refuses one bound to other bytes', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-ahead-' ) );
	const ahead = new StreetsAhead( directory, atlas );
	const prepared = await ahead.prepared();
	const other = { ...prepared, reference: { ...prepared.reference, blueprintSha256: sha256( Buffer.from( 'other city' ) ) } };
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: other } ) )
		.rejects.toMatchObject( { code: 'E_STREETS_SOURCE_MISMATCH' } );

	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: prepared } );
	expect( manifest.streets ).toEqual( prepared.reference );
	expect( manifest.streets.blueprintSha256 ).toBe( sha256( readFileSync( join( directory, 'blueprint.json' ) ) ) );
	const streets = JSON.parse( readFileSync( join( directory, manifest.streets.file ) ) );
	for ( const piece of streets.pieces ) expect( sha256( readFileSync( join( directory, 'streets', piece.asset ) ) ) ).toBe( piece.sha256 );
	ahead.dispose();

} );
