import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { hashJson, openWorldArchive, readWorldArchive, writeWorldArchive } from '../world-archive/index.js';
import { ConnectionsArtifact } from './ConnectionsArtifact.js';
import { OutDir } from './OutDir.js';
import { loadBlueprint } from './BlueprintInput.js';
import { runConnections } from './connectionsRunner.js';
import { validateWorldManifest } from './validators.js';
import atlas from './connections-city.fixture.json';

const options = { maxRecords: 1, maxPartBytes: 4096 };
const digest = bytes => createHash( 'sha256' ).update( bytes ).digest( 'hex' );
let root;
let connections;
beforeAll( async () => { connections = await runConnections( atlas, { seed: atlas.meta.seed } ); } );
afterEach( () => { vi.restoreAllMocks(); if ( root ) rmSync( root, { recursive: true, force: true } ); root = null; } );

function directory() {

	root = mkdtempSync( join( tmpdir(), 'urbe-archive-assembly-' ) );
	return root;

}

describe( 'archive assembly publication', () => {

	it( 'publishes bounded parts with exact index hashes and immutable source roundtrips', async () => {

		const out = new OutDir( directory() );
		const document = structuredClone( connections );
		const captured = structuredClone( document );
		const stringify = JSON.stringify;
		vi.spyOn( JSON, 'stringify' ).mockImplementation( ( value, ...rest ) => {

			if ( value === atlas || value?.networks?.walk ) throw new Error( 'whole document stringify is forbidden' );
			return stringify( value, ...rest );

		} );
		const artifact = new ConnectionsArtifact( atlas, document );
		document.networks.walk.edges.length = 0;
		const manifest = await out.writeArchiveManifest( atlas, [], [], null, artifact, options );
		const blueprintBytes = readFileSync( join( root, manifest.blueprint.file ) );
		const connectionsBytes = readFileSync( join( root, manifest.connections.file ) );
		expect( manifest.blueprint ).toEqual( { file: 'blueprint/index.json', encoding: 'archive', sha256: digest( blueprintBytes ) } );
		expect( manifest.connections ).toEqual( {
			file: 'connections/index.json', encoding: 'archive', sha256: digest( connectionsBytes ), blueprintSha256: digest( blueprintBytes )
		} );
		expect( JSON.parse( blueprintBytes ).json ).toEqual( hashJson( atlas ) );
		expect( JSON.parse( connectionsBytes ).json ).toEqual( hashJson( captured ) );
		expect( validateWorldManifest( manifest ) ).toEqual( [] );
		for ( const invalid of [
			{ ...manifest, blueprint: { ...manifest.blueprint, file: '../blueprint/index.json' } },
			{ ...manifest, blueprint: undefined },
			{ ...manifest, connections: { ...manifest.connections, encoding: undefined } },
			{ ...manifest, connections: { ...manifest.connections, file: 'connections.json' } }
		] ) expect( validateWorldManifest( invalid ).length ).toBeGreaterThan( 0 );
		expect( await readWorldArchive( join( root, 'blueprint' ), { concurrency: 1 } ) ).toEqual( atlas );
		expect( await readWorldArchive( join( root, 'connections' ), { concurrency: 1 } ) ).toEqual( captured );
		for ( const name of [ 'blueprint', 'connections' ] ) {

			const archive = await openWorldArchive( join( root, name ) );
			const parts = archive.index.collections.flatMap( collection => collection.parts );
			expect( parts.length ).toBeGreaterThan( 0 );
			expect( parts.every( part => part.bytes <= options.maxPartBytes && part.count <= options.maxRecords ) ).toBe( true );

		}
		expect( await ( await openWorldArchive( join( root, 'blueprint' ) ) ).readCollection( '/parcels', { start: 1, end: 2 } ) ).toEqual( [ atlas.parcels[ 1 ] ] );
		expect( existsSync( join( root, 'blueprint.json' ) ) ).toBe( false );
		expect( existsSync( join( root, 'connections.json' ) ) ).toBe( false );

	} );

	it( 'rejects changed source content and preserves previously published archives and manifest', async () => {

		const out = new OutDir( directory() );
		const artifact = new ConnectionsArtifact( atlas, connections );
		await out.writeArchiveManifest( atlas, [], [], null, artifact, options );
		const previous = readFileSync( join( root, 'manifest.json' ) );
		const moved = structuredClone( atlas );
		moved.parcels[ 0 ].footprint[ 0 ][ 0 ] += 1;
		await expect( out.writeArchiveManifest( moved, [], [], null, artifact, options ) )
			.rejects.toMatchObject( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } );
		expect( readFileSync( join( root, 'manifest.json' ) ) ).toEqual( previous );
		expect( await readWorldArchive( join( root, 'blueprint' ) ) ).toEqual( atlas );
		expect( readdirSync( root ).sort() ).toEqual( [ 'blueprint', 'connections', 'manifest.json' ] );

	} );

	it( 'reads archive files and directories and rejects a false original-content binding', async () => {

		const source = join( directory(), 'source' );
		await writeWorldArchive( atlas, source, options );
		for ( const input of [ source, join( source, 'index.json' ) ] ) {

			expect( await loadBlueprint( input ) ).toEqual( { atlas, encoding: 'archive', path: join( source, 'index.json' ) } );

		}
		const alias = join( source, 'other.json' );
		writeFileSync( alias, readFileSync( join( source, 'index.json' ) ) );
		await expect( loadBlueprint( alias ) ).rejects.toMatchObject( { code: 'E_REQUEST_INVALID' } );
		const index = JSON.parse( readFileSync( join( source, 'index.json' ) ) );
		index.json.sha256 = '0'.repeat( 64 );
		writeFileSync( join( source, 'index.json' ), JSON.stringify( index ) + '\n' );
		await expect( loadBlueprint( source ) ).rejects.toMatchObject( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } );

	} );

	it( 'rolls back prepared archive replacements when manifest publication fails', async () => {

		const out = new OutDir( directory() );
		const artifact = new ConnectionsArtifact( atlas, connections );
		await out.writeArchiveManifest( atlas, [], [], null, artifact, options );
		const original = readFileSync( join( root, 'blueprint/index.json' ) );
		rmSync( join( root, 'manifest.json' ) );
		mkdirSync( join( root, 'manifest.json' ) );
		const moved = structuredClone( atlas );
		moved.parcels[ 0 ].footprint[ 0 ][ 0 ] += 1;
		await expect( out.writeArchiveManifest( moved, [], [], null, new ConnectionsArtifact( moved, connections ), options ) ).rejects.toThrow();
		expect( readFileSync( join( root, 'blueprint/index.json' ) ) ).toEqual( original );
		expect( await readWorldArchive( join( root, 'connections' ) ) ).toEqual( connections );
		expect( readdirSync( root ).sort() ).toEqual( [ 'blueprint', 'connections', 'manifest.json' ] );

	} );

} );
