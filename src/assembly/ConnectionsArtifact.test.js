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

	it( 'publishes captured Connections bytes and binds every byte of the source blueprint', () => {

		dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );
		const source = structuredClone( atlas );
		const document = structuredClone( connections );
		const artifact = new ConnectionsArtifact( source, document );
		document.networks.walk.edges.length = 0;
		const manifest = new OutDir( dir ).writeManifest( source, [], [], null, artifact );
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

	it( 'refuses absent or schema-invalid output before publishing a manifest', () => {

		dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );
		const malformed = structuredClone( connections );
		malformed.networks.walk.edges[ 0 ].path3 = [ [ 0, 0 ] ];
		for ( const document of [ undefined, malformed ] ) {

			expect( () => new OutDir( dir ).writeManifest( atlas, [], [], null,
				new ConnectionsArtifact( atlas, document ) ) ).toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_INVALID' } ) );

		}
		expect( existsSync( join( dir, MANIFEST_FILE ) ) ).toBe( false );
		expect( existsSync( join( dir, CONNECTIONS_FILE ) ) ).toBe( false );

	} );

	it( 'rejects mismatched source seeds and same-seed Atlas changes after capture', () => {

		dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );
		for ( const field of [ 'seed', 'atlasSeed' ] ) {

			const document = { ...connections, meta: { ...connections.meta, [ field ]: 'different-city' } };
			expect( () => new ConnectionsArtifact( atlas, document ) )
				.toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } ) );

		}
		const artifact = new ConnectionsArtifact( atlas, connections );
		const moved = structuredClone( atlas );
		moved.parcels[ 0 ].footprint[ 0 ][ 0 ] += 1;

		expect( () => new OutDir( dir ).writeManifest( moved, [], [], null, artifact ) )
			.toThrow( expect.objectContaining( { code: 'E_CONNECTIONS_SOURCE_MISMATCH' } ) );
		expect( existsSync( join( dir, MANIFEST_FILE ) ) ).toBe( false );

	} );

	it.each( [ BLUEPRINT_FILE, CONNECTIONS_FILE, '.manifest.json.tmp' ] )(
		'keeps the previous manifest when %s cannot be written', ( blockedFile ) => {

			dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );
			const out = new OutDir( dir );
			out.writeManifest( atlas, [], [] );
			const previous = readFileSync( join( dir, MANIFEST_FILE ), 'utf8' );
			const blocked = join( dir, blockedFile );
			if ( existsSync( blocked ) ) rmSync( blocked );
			mkdirSync( blocked );

			expect( () => out.writeManifest( atlas, [], [], null, new ConnectionsArtifact( atlas, connections ) ) ).toThrow();
			expect( readFileSync( join( dir, MANIFEST_FILE ), 'utf8' ) ).toBe( previous );

		}
	);

	it( 'accepts the absent-field manifest and requires a complete fixed-file digest reference when declared', () => {

		dir = mkdtempSync( join( tmpdir(), 'urbe-connections-' ) );
		const manifest = new OutDir( dir ).writeManifest( atlas, [], [] );
		expect( manifest ).not.toHaveProperty( 'connections' );
		expect( validateWorldManifest( manifest ) ).toEqual( [] );
		for ( const reference of [
			null,
			{ file: '../connections.json', sha256: '0'.repeat( 64 ), blueprintSha256: '0'.repeat( 64 ) },
			{ file: CONNECTIONS_FILE, sha256: '0'.repeat( 64 ) },
			{ file: CONNECTIONS_FILE, sha256: 'wrong', blueprintSha256: '0'.repeat( 64 ) }
		] ) {

			expect( validateWorldManifest( { ...manifest, connections: reference } ).length ).toBeGreaterThan( 0 );

		}

	} );

} );

function sha256( bytes ) {

	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );

}
