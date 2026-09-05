import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { runConnections } from './connectionsRunner.js';
import atlas from './connections-city.fixture.json';

vi.mock( './connectionsRunner.js', async ( original ) => {

	const runner = await original();
	return { ...runner, runConnections: vi.fn( runner.runConnections ) };

} );

let dir;
const originalArgv = process.argv;

afterEach( () => {

	process.argv = originalArgv;
	vi.restoreAllMocks();
	if ( dir ) rmSync( dir, { recursive: true, force: true } );

} );

it( 'city CLI generates Connections once and persists that complete document', async () => {

	dir = mkdtempSync( join( tmpdir(), 'urbe-city-connections-' ) );
	for ( const parcel of atlas.parcels ) {

		const parcelDir = join( dir, parcel.id );
		mkdirSync( parcelDir );
		writeFileSync( join( parcelDir, `${parcel.id}.request.json` ), JSON.stringify( { parcel: { footprint: parcel.footprint } } ) );
		writeFileSync( join( parcelDir, `${parcel.id}.blueprint.json` ), '{}' );
		writeFileSync( join( parcelDir, `${parcel.id}.glb` ), 'glb' );

	}
	const blueprintPath = fileURLToPath( new URL( './connections-city.fixture.json', import.meta.url ) );
	process.argv = [ process.execPath, 'city-cli.js', '--blueprint', blueprintPath, '--out', dir,
		'--reuse-shells', 'true', '--interiors', '0' ];
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => {} );
	vi.spyOn( console, 'log' ).mockImplementation( () => {} );

	await import( './city-cli.js' );

	expect( exit ).toHaveBeenCalledExactlyOnceWith( 0 );
	expect( runConnections ).toHaveBeenCalledExactlyOnceWith( atlas, { seed: atlas.meta.seed } );
	const document = await runConnections.mock.results[ 0 ].value;
	const manifest = JSON.parse( readFileSync( join( dir, 'manifest.json' ), 'utf8' ) );
	expect( manifest.connections.file ).toBe( 'connections.json' );
	expect( readFileSync( join( dir, manifest.connections.file ), 'utf8' ) ).toBe( JSON.stringify( document ) + '\n' );
	expect( document.networks.walk.edges.length ).toBeGreaterThan( 0 );
	expect( document.networks.road.lanes.length ).toBeGreaterThan( 0 );
	expect( manifest.parcels ).toEqual( atlas.parcels.map( ( parcel ) => parcel.id ) );

} );
