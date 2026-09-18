import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { OutDir } from './OutDir.js';
import { collectShellArtifacts } from './ShellArtifacts.js';
import { validateExteriorBlueprint } from './validators.js';
import { KitManifest, blueprintFile, placementsFile, schemaMessage, validateKitPlacements } from './kit/index.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const BLUEPRINT = fileURLToPath( new URL( './kit-city.fixture.json', import.meta.url ) );
const atlas = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );
const PARCELS = atlas.parcels.map( ( parcel ) => parcel.id );

/**
 * One city run. Native streets currently refuse this Atlas version, which ends
 * the run after every building is on disk and its report is written, so the
 * exit status belongs to that step and not to the buildings.
 */
function assembleCity( out, { blueprint = BLUEPRINT, kitDir = null, options = [ '--interiors', '0' ] } = {} ) {

	const run = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', blueprint, '--out', out, ...options ], {
		cwd: ENGINE_ROOT, encoding: 'utf8', env: kitDir ? { ...process.env, URBE_KIT_DIR: kitDir } : process.env
	} );
	const reportPath = join( out, 'qa-report.json' );

	return {
		stderr: run.stderr,
		report: existsSync( reportPath ) ? JSON.parse( readFileSync( reportPath, 'utf8' ) ) : null,
		file: ( parcelId, name ) => readFileSync( join( out, parcelId, name ) ),
		has: ( parcelId, name ) => existsSync( join( out, parcelId, name ) )
	};

}

/** The same fixture with one parcel flipped to a landmark, so it changes path. */
function blueprintWithLandmark( dir, parcelId ) {

	const document = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );

	document.parcels.find( ( parcel ) => parcel.id === parcelId ).landmark = true;
	const path = join( dir, 'landmark.json' );

	writeFileSync( path, JSON.stringify( document ) );

	return path;

}

describe( 'assemble-city kit path', () => {

	let roots = [];

	afterEach( () => {

		for ( const root of roots ) rmSync( root, { recursive: true, force: true } );
		roots = [];

	} );

	function city( options ) {

		const root = mkdtempSync( join( tmpdir(), 'urbe-kit-city-' ) );

		roots.push( root );

		return { root, ...assembleCity( root, options ) };

	}

	function scratch() {

		const root = mkdtempSync( join( tmpdir(), 'urbe-kit-scratch-' ) );

		roots.push( root );

		return root;

	}

	it( 'assembles ordinary parcels from the kit and generates the landmark', () => {

		const { root, report, has, file } = city();

		expect( report.totals ).toMatchObject( { parcels: 3, passed: 3, failed: 0, kit: 2, generated: 1 } );
		expect( report.parcels.map( ( parcel ) => [ parcel.parcelId, parcel.source ] ) )
			.toEqual( [ [ 'p0', 'shell' ], [ 'p1', 'kit' ], [ 'p2', 'kit' ] ] );

		expect( has( 'p0', 'p0.glb' ) ).toBe( true );
		expect( has( 'p0', placementsFile( 'p0' ) ) ).toBe( false );

		for ( const parcelId of [ 'p1', 'p2' ] ) {

			expect( has( parcelId, `${parcelId}.glb` ) ).toBe( false );
			const table = JSON.parse( file( parcelId, placementsFile( parcelId ) ).toString( 'utf8' ) );
			const blueprint = JSON.parse( file( parcelId, blueprintFile( parcelId ) ).toString( 'utf8' ) );

			expect( schemaMessage( validateKitPlacements( table ) ) ).toBe( '' );
			expect( schemaMessage( validateExteriorBlueprint( blueprint ) ) ).toBe( '' );
			expect( table.parcel ).toBe( parcelId );

		}

		const kit = KitManifest.load();

		expect( readFileSync( join( root, 'kit', 'kit.json' ) ).equals( readFileSync( join( kit.dir, 'kit.json' ) ) ) ).toBe( true );

	}, 120_000 );

	it( 'gives the same blueprint the same buildings, byte for byte', () => {

		const first = city();
		const second = city();

		for ( const parcelId of [ 'p1', 'p2' ] ) {

			for ( const name of [ placementsFile( parcelId ), blueprintFile( parcelId ) ] ) {

				expect( second.file( parcelId, name ).equals( first.file( parcelId, name ) ) ).toBe( true );

			}

		}

	}, 120_000 );

	it( 'ships one building per parcel when a parcel changes path', () => {

		const { root } = city();
		const landmark = blueprintWithLandmark( scratch(), 'p1' );
		const regenerated = assembleCity( root, { blueprint: landmark, options: [ '--interiors', '0', '--parcel', 'p1' ] } );

		expect( regenerated.has( 'p1', 'p1.glb' ) ).toBe( true );
		expect( regenerated.has( 'p1', placementsFile( 'p1' ) ) ).toBe( false );
		expect( new OutDir( root ).kits( PARCELS ) ).toEqual( [ 'p2' ] );
		expect( regenerated.report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' ).source ).toBe( 'shell' );

		const placed = assembleCity( root, { options: [ '--interiors', '0', '--parcel', 'p1' ] } );

		expect( placed.has( 'p1', placementsFile( 'p1' ) ) ).toBe( true );
		expect( placed.has( 'p1', 'p1.glb' ) ).toBe( false );
		expect( placed.has( 'p1', 'p1.request.json' ) ).toBe( false );
		expect( new OutDir( root ).kits( PARCELS ) ).toEqual( [ 'p1', 'p2' ] );

		const p1 = placed.report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' );

		expect( p1.source ).toBe( 'kit' );
		expect( p1.bytes ).toBeLessThan( 200_000 );

	}, 120_000 );

	it( 'assembles the city with every building generated when no kit is published', () => {

		const { root, report, has } = city( { kitDir: scratch() } );

		expect( report.totals ).toMatchObject( { parcels: 3, passed: 3, failed: 0, kit: 0, generated: 3 } );
		expect( report.parcels.every( ( parcel ) => parcel.source === 'shell' ) ).toBe( true );
		expect( existsSync( join( root, 'kit' ) ) ).toBe( false );

		for ( const parcelId of PARCELS ) {

			expect( has( parcelId, `${parcelId}.glb` ) ).toBe( true );
			expect( has( parcelId, placementsFile( parcelId ) ) ).toBe( false );

		}

	}, 120_000 );

	it( 'generates the shell of a kit parcel that was picked to open', () => {

		const { report, has, stderr } = city( { options: [ '--interior-parcels', 'p1' ] } );
		const p1 = report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' );

		expect( stderr ).not.toContain( 'E_INTERIOR_SELECTION' );
		expect( p1.source ).toBe( 'shell' );
		expect( has( 'p1', 'p1.glb' ) ).toBe( true );
		expect( has( 'p1', placementsFile( 'p1' ) ) ).toBe( false );
		expect( report.parcels.find( ( parcel ) => parcel.parcelId === 'p2' ).source ).toBe( 'kit' );

	}, 120_000 );

	it( 'publishes a manifest naming the kit and a catalog holding its buildings', async () => {

		const { root } = city();
		const out = new OutDir( root );
		const shells = out.shells( PARCELS );
		const kits = out.kits( shells );
		const kit = KitManifest.load();
		const { catalog } = await collectShellArtifacts( root, shells, { seed: atlas.meta.seed } );
		const manifest = await out.publishManifest( atlas, shells, [], {
			catalog, kit: kit.publish( root ),
			sources: Object.fromEntries( shells.map( ( id ) => [ id, kits.includes( id ) ? 'kit' : 'shell' ] ) )
		} );

		expect( shells ).toEqual( PARCELS );
		expect( kits ).toEqual( [ 'p1', 'p2' ] );
		expect( manifest.kit ).toEqual( { file: 'kit/kit.json', sha256: kit.sha256 } );
		expect( manifest.sources ).toEqual( { p0: 'shell', p1: 'kit', p2: 'kit' } );
		expect( catalog.buildings.map( ( building ) => building.id ) ).toEqual( PARCELS );

		const p1 = catalog.buildings.find( ( building ) => building.id === 'p1' );
		const table = JSON.parse( readFileSync( join( root, 'p1', placementsFile( 'p1' ) ), 'utf8' ) );

		expect( p1.floorCount ).toBe( table.floors );
		expect( p1.bounds ).toEqual( table.bounds );

	}, 120_000 );

} );
