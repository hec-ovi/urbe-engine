import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import atlas from './native-city.fixture.json';
import { OutDir } from './OutDir.js';
import { sha256 } from './JsonFile.js';
import { StreetsAhead } from './StreetsAhead.js';
import { sharedPath, sharedRoot } from './SharedResources.js';

let directory, store;
// The shared store is the machine's, and this file proves what stands in it.
const previous = process.env.URBE_SHARED_DIR;
beforeAll( () => { store = mkdtempSync( join( tmpdir(), 'assembly-shared-' ) ); process.env.URBE_SHARED_DIR = store; } );
afterAll( () => { rmSync( store, { recursive: true, force: true } ); if ( previous === undefined ) delete process.env.URBE_SHARED_DIR; else process.env.URBE_SHARED_DIR = previous; } );
afterEach( () => { if ( directory ) rmSync( directory, { recursive: true, force: true } ); } );

/**
 * Reads the published bundle and proves every piece and placement the kit
 * promises. The world keeps its own placements; the kit and its piece files
 * stand in the shared store every city of this design reads.
 */
function readBundle( root, reference ) {

	const kitDir = join( sharedRoot(), reference.sharedKit );
	const manifestBytes = readFileSync( join( root, 'streets', 'manifest.json' ) );
	const kitBytes = readFileSync( join( kitDir, 'kit.json' ) );
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

	for ( const piece of kit.pieces ) expect( sha256( readFileSync( join( kitDir, piece.file ) ) ) ).toBe( piece.sha256 );
	const pieces = new Set( kit.pieces.map( piece => piece.id ) );
	for ( const placement of placements.placements ) expect( pieces.has( placement.piece ) ).toBe( true );

	return { manifest, digests: { sha256: sha256( manifestBytes ), kitSha256: sha256( kitBytes ) } };

}

it( 'publishes the street kit, its placements and its pieces bound to the staged blueprint', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-' ) );
	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true } );
	const blueprintBytes = readFileSync( join( directory, 'blueprint.json' ) );
	const { manifest: streets, digests } = readBundle( directory, manifest.streets );

	expect( manifest.streets ).toEqual( {
		file: 'streets/manifest.json', ...digests, blueprintSha256: sha256( blueprintBytes ),
		sharedKit: sharedPath( 'streets-kit', digests.kitSha256 )
	} );
	expect( streets.meta ).toMatchObject( {
		version: '0.5.0', architectureVersion: atlas.meta.version,
		blueprintEncoding: 'json-file-bytes', blueprintHash: manifest.streets.blueprintSha256
	} );
	expect( streets.kit.version ).toBe( '1.2.0' );
	expect( streets.placements.version ).toBe( '1.2.0' );
	// The kit and its pieces stand in the store; the world keeps what is its own.
	expect( readdirSync( join( directory, 'streets' ) ).sort() ).toEqual( [ 'manifest.json', 'placements.json' ] );
	expect( JSON.parse( blueprintBytes ) ).toEqual( atlas );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

	// a build that fails leaves the world exactly as it stood
	const documents = [ 'blueprint.json', 'manifest.json', 'streets/manifest.json', 'streets/placements.json' ];
	const before = documents.map( name => readFileSync( join( directory, name ) ) );
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: { nativeMaterials: join( directory, 'missing.json' ) } } ) ).rejects.toMatchObject( { code: 'E_STREETS_BUILD' } );
	for ( const [ index, name ] of documents.entries() ) expect( readFileSync( join( directory, name ) ) ).toEqual( before[ index ] );
	expect( readdirSync( directory ).some( name => name.startsWith( '.world-archive-' ) ) ).toBe( false );

}, 120_000 );

it( 'stores the one street kit every city of this design shares', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-shared-' ) );
	const cities = [];
	for ( const seed of [ 11, 22 ] ) {

		const root = join( directory, `city-${seed}` );
		mkdirSync( root );
		cities.push( await new OutDir( root ).publishManifest( atlas, [], [], { streets: { seed } } ) );

	}

	// The catalogue is the same 187 pieces whatever city stands on it, so both
	// worlds name one folder of the store and it holds one entry.
	const [ first, second ] = cities.map( manifest => manifest.streets );
	expect( second.sharedKit ).toBe( first.sharedKit );
	expect( second.sha256 ).not.toBe( first.sha256 );
	expect( readdirSync( join( store, 'streets-kit' ) ) ).toEqual( [ first.sharedKit.split( '/' )[ 1 ] ] );
	const kit = JSON.parse( readFileSync( join( sharedRoot(), first.sharedKit, 'kit.json' ), 'utf8' ) );
	expect( kit.pieces ).toHaveLength( 187 );
	for ( const city of cities ) expect( city.streets.kitSha256 ).toBe( first.kitSha256 );

}, 180_000 );

it( 'adopts an ahead-of-time streets build, refuses one bound to other bytes and refuses archive publication', async () => {

	directory = mkdtempSync( join( tmpdir(), 'assembly-streets-ahead-' ) );

	// native streets need ordinary blueprint JSON: nothing is staged before it is refused
	await expect( new OutDir( directory ).publishManifest( atlas, [], [], { encoding: 'archive', streets: true } ) ).rejects.toMatchObject( { code: 'E_STREETS_ARCHIVE_UNSUPPORTED' } );
	expect( readdirSync( directory ) ).toEqual( [] );

	const ahead = new StreetsAhead( directory, atlas );
	const prepared = await ahead.prepared();

	for ( const field of [ 'blueprintSha256', 'sha256', 'kitSha256' ] ) {

		const other = { ...prepared, reference: { ...prepared.reference, [ field ]: sha256( Buffer.from( 'other city' ) ) } };
		await expect( new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: other } ) )
			.rejects.toMatchObject( { code: 'E_STREETS_SOURCE_MISMATCH' } );

	}

	const manifest = await new OutDir( directory ).publishManifest( atlas, [], [], { streets: true, streetsPrepared: prepared } );
	expect( manifest.streets ).toEqual( { ...prepared.reference, sharedKit: sharedPath( 'streets-kit', prepared.reference.kitSha256 ) } );
	expect( manifest.streets.blueprintSha256 ).toBe( sha256( readFileSync( join( directory, 'blueprint.json' ) ) ) );
	const { digests } = readBundle( directory, manifest.streets );
	expect( digests ).toEqual( { sha256: manifest.streets.sha256, kitSha256: manifest.streets.kitSha256 } );
	ahead.dispose();

}, 120_000 );
