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

/** Reads the published bundle and proves every piece and placement the kit promises. */
function readBundle( root ) {

	const manifestBytes = readFileSync( join( root, 'streets', 'manifest.json' ) );
	const kitBytes = readFileSync( join( root, 'streets', 'kit.json' ) );
	const placementBytes = readFileSync( join( root, 'streets', 'placements.json' ) );
	const manifest = JSON.parse( manifestBytes );
	const kit = JSON.parse( kitBytes );
	const placements = JSON.parse( placementBytes );

	expect( manifest.files ).toEqual( { kit: 'streets/kit.json', placements: 'streets/placements.json' } );
	expect( kit ).toEqual( manifest.kit );
	expect( placements ).toEqual( manifest.placements );
	expect( kit.pieces ).toHaveLength( manifest.statistics.pieces );
	expect( placements.placements ).toHaveLength( manifest.statistics.placements );
	expect( manifest ).not.toHaveProperty( 'assets' );

	for ( const piece of kit.pieces ) expect( sha256( readFileSync( join( root, 'streets', piece.file ) ) ) ).toBe( piece.sha256 );
	const pieces = new Set( kit.pieces.map( piece => piece.id ) );
	for ( const placement of placements.placements ) expect( pieces.has( placement.piece ) ).toBe( true );

	return { manifest, digests: { sha256: sha256( manifestBytes ), kitSha256: sha256( kitBytes ) } };

}

it( 'publishes the street kit, its placements and its pieces bound to the staged blueprint', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-' ) );
	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true } );
	const blueprintBytes = readFileSync( join( directory, 'blueprint.json' ) );
	const { manifest: streets, digests } = readBundle( directory );

	expect( manifest.streets ).toEqual( { file: 'streets/manifest.json', ...digests, blueprintSha256: sha256( blueprintBytes ) } );
	expect( streets.meta ).toMatchObject( {
		version: '0.3.0', architectureVersion: atlas.meta.version,
		blueprintEncoding: 'json-file-bytes', blueprintHash: manifest.streets.blueprintSha256
	} );
	expect( JSON.parse( blueprintBytes ) ).toEqual( atlas );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

	const documents = [ 'blueprint.json', 'manifest.json', 'streets/manifest.json', 'streets/kit.json', 'streets/placements.json' ];
	const before = documents.map( name => readFileSync( join( directory, name ) ) );
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: { nativeMaterials: join( directory, 'missing.json' ) } } ) ).rejects.toMatchObject( { code: 'E_STREETS_BUILD' } );
	for ( const [ index, name ] of documents.entries() ) expect( readFileSync( join( directory, name ) ) ).toEqual( before[ index ] );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

}, 120_000 );

it( 'rejects archive-native publication before creating staging artifacts', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-archive-' ) );
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { encoding: 'archive', streets: true } ) ).rejects.toMatchObject( { code: 'E_STREETS_ARCHIVE_UNSUPPORTED' } );
	expect( readdirSync( directory ) ).toEqual( [] );

} );

it( 'adopts an ahead-of-time streets build and refuses one bound to other bytes', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-ahead-' ) );
	const ahead = new StreetsAhead( directory, atlas );
	const prepared = await ahead.prepared();

	for ( const field of [ 'blueprintSha256', 'sha256', 'kitSha256' ] ) {

		const other = { ...prepared, reference: { ...prepared.reference, [ field ]: sha256( Buffer.from( 'other city' ) ) } };
		await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: other } ) )
			.rejects.toMatchObject( { code: 'E_STREETS_SOURCE_MISMATCH' } );

	}

	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: prepared } );
	expect( manifest.streets ).toEqual( prepared.reference );
	expect( manifest.streets.blueprintSha256 ).toBe( sha256( readFileSync( join( directory, 'blueprint.json' ) ) ) );
	const { digests } = readBundle( directory );
	expect( digests ).toEqual( { sha256: manifest.streets.sha256, kitSha256: manifest.streets.kitSha256 } );
	ahead.dispose();

}, 120_000 );
