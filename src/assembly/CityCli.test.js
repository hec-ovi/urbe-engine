import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const BLUEPRINT = resolve( ENGINE_ROOT, '../atlas/samples/city-urbe-tiny.json' );

describe( 'assemble-city CLI', () => {

	let root = null;

	afterEach( () => {

		if ( root ) rmSync( root, { recursive: true, force: true } );
		root = null;

	} );

	it( 'turns a complete shell-only city into a validated reusable stage without rebuilding it', () => {

		root = mkdtempSync( join( tmpdir(), 'urbe-city-stage-' ) );
		const atlas = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );

		for ( const parcel of atlas.parcels ) {

			const dir = join( root, parcel.id );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( join( dir, `${parcel.id}.request.json` ), JSON.stringify( { parcel: { footprint: parcel.footprint } } ) );
			writeFileSync( join( dir, `${parcel.id}.blueprint.json` ), '{}' );
			writeFileSync( join( dir, `${parcel.id}.glb` ), 'glb' );

		}

		const run = spawnSync( process.execPath, [
			'--import', 'tsx', 'src/assembly/city-cli.js',
			'--blueprint', BLUEPRINT, '--out', root,
			'--reuse-shells', 'true', '--interiors', '0'
		], { cwd: ENGINE_ROOT, encoding: 'utf8' } );

		expect( run.status, run.stderr || run.stdout ).toBe( 0 );
		const manifest = JSON.parse( readFileSync( join( root, 'manifest.json' ), 'utf8' ) );
		const report = JSON.parse( readFileSync( join( root, 'qa-report.json' ), 'utf8' ) );
		expect( manifest.parcels ).toHaveLength( atlas.parcels.length );
		expect( manifest.interiors ).toEqual( [] );
		expect( report.totals ).toMatchObject( {
			parcels: atlas.parcels.length, passed: atlas.parcels.length, failed: 0,
			interiorsRequested: 0, interiorsReady: 0
		} );

	}, 20_000 );

} );
