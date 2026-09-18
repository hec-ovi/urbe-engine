import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConnectionsArtifact, CONNECTIONS_FILE } from './ConnectionsArtifact.js';
import { OutDir, BLUEPRINT_FILE, MANIFEST_FILE } from './OutDir.js';
import { runConnections } from './connectionsRunner.js';
import { validateWorldManifest } from './validators.js';
import atlas from './connections-city.fixture.json';

describe( 'assembled Connections artifact', () => {

	let dir;
	let connections;

	beforeAll( async () => {

		connections = await runConnections( atlas, { seed: atlas.meta.seed } );

	} );

	afterEach( () => {

		if ( dir ) rmSync( dir, { recursive: true, force: true } );
		dir = null;

	} );

	function directory() {

		dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );

		return dir;

	}

	it( 'publishes captured Connections bytes and binds every byte of the source blueprint', () => {

		const source = structuredClone( atlas );
		const document = structuredClone( connections );
		const artifact = new ConnectionsArtifact( source, document );

		// the artifact holds its own snapshot: a later edit of the document never reaches the world
		document.networks.walk.edges.length = 0;

		const manifest = new OutDir( directory() ).writeManifest( source, [], [], null, artifact );
		const payloadBytes = readFileSync( join( dir, CONNECTIONS_FILE ) );
		const blueprintBytes = readFileSync( join( dir, BLUEPRINT_FILE ) );

		expect( payloadBytes.toString( 'utf8' ) ).toBe( JSON.stringify( connections ) + '\n' );
		expect( blueprintBytes.toString( 'utf8' ) ).toBe( JSON.stringify( source ) + '\n' );
		expect( manifest.connections ).toEqual( {
			file: CONNECTIONS_FILE,
			sha256: sha256( payloadBytes ),
			blueprintSha256: sha256( blueprintBytes )
		} );
		expect( validateWorldManifest( manifest ) ).toEqual( [] );
		expect( existsSync( join( dir, '.manifest.json.tmp' ) ) ).toBe( false );

	} );

	it( 'refuses invalid, mismatched or unwritable Connections data without publishing a manifest', () => {

		const malformed = structuredClone( connections );
		malformed.networks.walk.edges[ 0 ].path3 = [ [ 0, 0 ] ];
		const out = new OutDir( directory() );

		for ( const document of [ undefined, malformed ] ) {

			expect( () => out.writeManifest( atlas, [], [], null, new ConnectionsArtifact( atlas, document ) ) )
				.toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_INVALID' } ) );

		}

		for ( const field of [ 'seed', 'atlasSeed' ] ) {

			const document = { ...connections, meta: { ...connections.meta, [ field ]: 'different-city' } };

			expect( () => new ConnectionsArtifact( atlas, document ) )
				.toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } ) );

		}

		const artifact = new ConnectionsArtifact( atlas, connections );
		const moved = structuredClone( atlas );
		moved.parcels[ 0 ].footprint[ 0 ][ 0 ] += 1;

		expect( () => out.writeManifest( moved, [], [], null, artifact ) )
			.toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } ) );
		expect( existsSync( join( dir, MANIFEST_FILE ) ) ).toBe( false );
		expect( existsSync( join( dir, CONNECTIONS_FILE ) ) ).toBe( false );

		// a manifest without the artifact stays readable, and a published world keeps its
		// previous manifest when one of the documents cannot be written
		const manifest = out.writeManifest( atlas, [], [] );

		expect( manifest ).not.toHaveProperty( 'connections' );
		expect( validateWorldManifest( manifest ) ).toEqual( [] );

		const previous = readFileSync( join( dir, MANIFEST_FILE ), 'utf8' );

		mkdirSync( join( dir, CONNECTIONS_FILE ) );
		expect( () => out.writeManifest( atlas, [], [], null, artifact ) ).toThrow();
		expect( readFileSync( join( dir, MANIFEST_FILE ), 'utf8' ) ).toBe( previous );

		// a declared reference has to name the fixed file and carry both complete digests
		for ( const reference of [
			null,
			{ file: '../connections.json', sha256: '0'.repeat( 64 ), blueprintSha256: '0'.repeat( 64 ) },
			{ file: CONNECTIONS_FILE, sha256: '0'.repeat( 64 ) },
			{ file: CONNECTIONS_FILE, sha256: 'wrong', blueprintSha256: '0'.repeat( 64 ) }
		] ) expect( validateWorldManifest( { ...manifest, connections: reference } ).length ).toBeGreaterThan( 0 );

	} );

} );

function sha256( bytes ) {

	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );

}
