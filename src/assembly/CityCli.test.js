import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readWorldArchive } from '../world-archive/index.js';
import { shellBlueprint } from './shell-blueprints.fixture.js';
import { BuildingBlueprints } from './BuildingBlueprints.js';
import { PlanLibrary } from './kit/index.js';
import { cloneWorld } from './WorldClone.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const BLUEPRINT = fileURLToPath( new URL( './native-city.fixture.json', import.meta.url ) );

function cityCli( root, options ) {

	return spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', BLUEPRINT, '--out', root, ...options ], { cwd: ENGINE_ROOT, encoding: 'utf8' } );

}

/** How far a point on the ground plane stands from one facade segment. */
function offFace( [ x, z ], from, to ) {

	const dx = to[ 0 ] - from[ 0 ];
	const dz = to[ 1 ] - from[ 1 ];
	const length = dx * dx + dz * dz;
	const along = Math.max( 0, Math.min( 1, ( ( x - from[ 0 ] ) * dx + ( z - from[ 1 ] ) * dz ) / length ) );

	return Math.hypot( x - ( from[ 0 ] + dx * along ), z - ( from[ 1 ] + dz * along ) );

}

describe( 'assemble-city CLI', () => {

	let root = null;

	afterEach( () => {

		if ( root ) rmSync( root, { recursive: true, force: true } );
		root = null;

	} );

	it( 'rejects invalid and contradictory CLI inputs before publishing artifacts', () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-city-invalid-' ) );
		for ( const options of [ [ '--workers', '2.5' ], [ '--reuse-shells', 'true', '--parcel', 'p0' ] ] ) {

			expect( cityCli( root, options ).status ).toBe( 2 );
			expect( existsSync( join( root, 'manifest.json' ) ) ).toBe( false );

		}

	} );

	it( 'publishes the world the shells it kept stand in: catalog, connections and native streets', async () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-city-stage-' ) );
		const atlas = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );

		for ( const parcel of atlas.parcels ) {

			const dir = join( root, parcel.id );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( join( dir, `${parcel.id}.request.json` ), JSON.stringify( { parcel: { footprint: parcel.footprint } } ) );
			writeFileSync( join( dir, `${parcel.id}.blueprint.json` ), JSON.stringify( shellBlueprint( parcel ) ) );
			writeFileSync( join( dir, `${parcel.id}.glb` ), 'glb' );

		}

		const run = cityCli( root, [ '--reuse-shells', 'true', '--interiors', '0' ] );

		expect( run.status, run.stderr || run.stdout ).toBe( 0 );
		const manifest = JSON.parse( readFileSync( join( root, 'manifest.json' ), 'utf8' ) );
		const report = JSON.parse( readFileSync( join( root, 'qa-report.json' ), 'utf8' ) );
		expect( manifest.parcels ).toHaveLength( atlas.parcels.length );
		expect( manifest.interiors ).toEqual( [] );
		expect( manifest.shellCatalog.file ).toBe( 'shells/index.json' );
		expect( ( await readWorldArchive( join( root, 'shells' ) ) ).buildings.map( building => building.id ) ).toEqual( manifest.parcels );
		expect( report.totals ).toMatchObject( {
			parcels: atlas.parcels.length, passed: atlas.parcels.length, failed: 0,
			interiorsRequested: 0, interiorsReady: 0
		} );
		expect( manifest ).not.toHaveProperty( 'blueprint' );
		expect( manifest.connections.file ).toBe( 'connections.json' );
		expect( manifest.streets.file ).toBe( 'streets/manifest.json' );
		expect( manifest.streets.blueprintSha256 ).toBe( manifest.connections.blueprintSha256 );

		// A draft cloned from this world republishes the same documents and keeps sharing them.
		const draft = join( mkdtempSync( join( tmpdir(), 'urbe-city-draft-' ) ), 'draft' );
		try {

			await cloneWorld( root, draft );
			const again = cityCli( draft, [ '--reuse-shells', 'true', '--interiors', '0' ] );

			expect( again.status, again.stderr || again.stdout ).toBe( 0 );
			for ( const file of [ 'blueprint.json', 'connections.json', 'streets/manifest.json', 'streets/placements.json', 'shells/index.json' ] ) {

				expect( statSync( join( draft, file ) ).ino, file ).toBe( statSync( join( root, file ) ).ino );

			}

		} finally { rmSync( dirname( draft ), { recursive: true, force: true } ); }

	}, 40_000 );

	it( 'plans the links against the facade a kit building stands on, not the lot Atlas drew', async () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-city-links-' ) );
		const parcels = [ 'p16', 'p17' ];
		const run = cityCli( root, [ '--parcel', parcels.join( ',' ), '--interiors', '0' ] );

		expect( run.status, run.stderr || run.stdout ).toBe( 0 );
		const connections = JSON.parse( readFileSync( join( root, 'connections.json' ), 'utf8' ) );
		const blueprints = new BuildingBlueprints( root, new PlanLibrary( { workers: null } ) );
		const ends = connections.apertures.filter( ( aperture ) => parcels.includes( aperture.buildingId ) );

		// A shared building is inset from the Atlas massing, so an end cut on the
		// parcel Atlas drew hangs off the wall or pierces it.
		expect( ends.length ).toBeGreaterThan( 0 );
		for ( const aperture of ends ) {

			const { footprint } = ( await blueprints.of( aperture.buildingId ) ).bounds;
			const from = footprint[ aperture.face ];
			const to = footprint[ ( aperture.face + 1 ) % footprint.length ];

			for ( const [ x,, z ] of aperture.cut.polygon ) {

				expect( offFace( [ x, z ], from, to ) ).toBeLessThan( 0.01 );

			}

		}

	}, 300_000 );

} );
