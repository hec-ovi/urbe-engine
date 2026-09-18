import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import AjvModule from 'ajv/dist/2020.js';
import { OutDir } from './OutDir.js';
import { SchemaFiles } from './SchemaFiles.js';
import { InteriorModules, MODULES_FILE, MODULES_FOLDER, PROPS_FILE } from './InteriorModules.js';
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
function assembleCity( out, { blueprint = BLUEPRINT, kitDir = null, modulesDir = null, options = [ '--interiors', '0' ] } = {} ) {

	const env = { ...process.env };

	if ( kitDir ) env.URBE_KIT_DIR = kitDir;
	if ( modulesDir ) env.URBE_INTERIOR_MODULES_DIR = modulesDir;

	const run = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', blueprint, '--out', out, ...options ], { cwd: ENGINE_ROOT, encoding: 'utf8', env } );
	const reportPath = join( out, 'qa-report.json' );

	return {
		stdout: run.stdout,
		stderr: run.stderr,
		report: existsSync( reportPath ) ? JSON.parse( readFileSync( reportPath, 'utf8' ) ) : null,
		file: ( parcelId, name ) => readFileSync( join( out, parcelId, name ) ),
		has: ( parcelId, name ) => existsSync( join( out, parcelId, name ) )
	};

}

/** The same fixture with one parcel changed, so it takes another path. */
function blueprintWith( dir, parcelId, change ) {

	const document = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );

	Object.assign( document.parcels.find( ( parcel ) => parcel.id === parcelId ), change );
	const path = join( dir, `${parcelId}-variant.json` );

	writeFileSync( path, JSON.stringify( document ) );

	return path;

}

/** Interior's published schemas, so the furnished files are checked by their own box. */
const interiorSchemas = ( () => {

	const ajv = new ( AjvModule.default ?? AjvModule )( { allErrors: true, strict: false } );
	const files = new SchemaFiles( ajv );

	// Each file pulls in the schemas it references, npc.schema.json among them.
	for ( const name of [ 'building', 'floor-placement' ] ) {

		files.add( new URL( `../../../interior/schemas/${name}.schema.json`, import.meta.url ) );

	}

	return ( id, document ) => {

		const validate = ajv.getSchema( id );

		return validate( document ) ? '' : ajv.errorsText( validate.errors );

	};

} )();

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
		const landmark = blueprintWith( scratch(), 'p1', { landmark: true } );
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

	it( 'furnishes a kit parcel from the pieces it already stands on', () => {

		const { root, report, has, file } = city( { options: [ '--interior-parcels', 'p1' ] } );
		const p1 = report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' );

		expect( report.totals ).toMatchObject( { interiorsRequested: 1, interiorsReady: 1, interiorsFailed: 0 } );
		expect( p1 ).toMatchObject( { source: 'kit', interior: 'ready', coreMode: 'standard' } );
		// The building it was furnished from is the one that stands: its pieces.
		expect( has( 'p1', placementsFile( 'p1' ) ) ).toBe( true );
		expect( has( 'p1', 'p1.glb' ) ).toBe( false );

		const interior = ( name ) => JSON.parse( file( 'p1', join( 'interior', name ) ).toString( 'utf8' ) );
		const building = interior( 'building.json' );

		expect( interiorSchemas( 'https://urbe.dev/interior/building.schema.json', building ) ).toBe( '' );
		expect( Object.keys( building.layouts ).sort() ).toEqual( [ 'crown', 'ground', 'middle' ] );
		expect( building.floors.map( ( floor ) => floor.index ) ).toEqual( [ 0, 1, 2, 3, 4 ] );

		for ( const layout of Object.values( building.layouts ) ) {

			expect( interiorSchemas( 'https://urbe.dev/interior/floor-placement.schema.json', interior( layout ) ) ).toBe( '' );

		}

		expect( interiorSchemas( 'urbe/interior/npc', interior( 'npc.json' ) ) ).toBe( '' );
		expect( new OutDir( root ).interiors( PARCELS ) ).toEqual( [ 'p1' ] );

	}, 120_000 );

	it( 'binds the one shared module set every furnished building draws from', async () => {

		const { root } = city( { options: [ '--interior-parcels', 'p1' ] } );
		const out = new OutDir( root );
		const shells = out.shells( PARCELS );
		const bytes = readFileSync( join( root, MODULES_FILE ) );
		// The world already carries the set, so publishing again keeps those bytes.
		const references = await new InteriorModules( join( root, MODULES_FOLDER ) ).publish( root );
		const manifest = await out.publishManifest( atlas, shells, out.interiors( shells ), {
			interiorModules: references.modules, interiorProps: references.props
		} );

		expect( readFileSync( join( root, MODULES_FILE ) ).equals( bytes ) ).toBe( true );
		expect( manifest.interiorModules ).toEqual( { file: MODULES_FILE, sha256: references.modules.sha256 } );
		expect( manifest.interiors ).toEqual( [ 'p1' ] );
		expect( manifest.floors.p1 ).toEqual( [ '000', '001', '002', '003', '004' ] );
		expect( JSON.parse( bytes.toString( 'utf8' ) ).modules.length ).toBeGreaterThan( 0 );

	}, 120_000 );

	it( 'publishes the furniture catalog and its models beside the modules', () => {

		const { root, file } = city( { options: [ '--interior-parcels', 'p1' ] } );
		const catalog = JSON.parse( readFileSync( join( root, PROPS_FILE ), 'utf8' ) );
		const building = JSON.parse( file( 'p1', join( 'interior', 'building.json' ) ).toString( 'utf8' ) );

		// building.json names both catalogs against one resource base, so both stand there.
		expect( join( dirname( MODULES_FILE ), building.modules ) ).toBe( MODULES_FILE );
		expect( join( dirname( MODULES_FILE ), building.props ) ).toBe( PROPS_FILE );

		// Every furniture id a placement can name resolves to a model that travelled with it.
		const models = catalog.assets.filter( ( asset ) => asset.modelUri );

		expect( models.length ).toBeGreaterThan( 0 );
		for ( const asset of models ) {

			expect( existsSync( join( root, MODULES_FOLDER, asset.modelUri ) ) ).toBe( true );

		}

	}, 120_000 );

	it( 'leaves a building shorter than three floors out of the candidates', () => {

		const shorter = blueprintWith( scratch(), 'p0', {
			envelope: { minFloors: 2, maxFloors: 2, floorHeight: 4.5, maxHeight: 12 }
		} );
		const { root, report, stdout, has } = city( { blueprint: shorter, options: [ '--interior-parcels', 'p0' ] } );

		expect( report.parcels.find( ( parcel ) => parcel.parcelId === 'p0' ).interior ).toBe( 'closed' );
		expect( report.totals ).toMatchObject( { interiorsReady: 0, interiorsFailed: 0 } );
		expect( stdout ).toContain( 'fewer than three floors' );
		expect( has( 'p0', 'p0.glb' ) ).toBe( true );
		expect( existsSync( join( root, MODULES_FOLDER ) ) ).toBe( false );

	}, 120_000 );

	it( 'keeps the building closed when its interior fails', () => {

		const modulesDir = scratch();

		writeFileSync( join( modulesDir, 'modules.json' ), '{"version":1,"grid":0.5}' );
		const { root, report, has } = city( { modulesDir, options: [ '--interior-parcels', 'p1' ] } );

		expect( report.totals ).toMatchObject( { passed: 3, failed: 0, interiorsReady: 0, interiorsFailed: 1 } );
		expect( report.interiorFailures[ 0 ].error ).toContain( 'E_INTERIOR_FAILED' );
		expect( report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' ).interior ).toBe( 'closed' );
		// The shell still stands, closed: its pieces and its blueprint are untouched.
		expect( has( 'p1', placementsFile( 'p1' ) ) ).toBe( true );
		expect( has( 'p1', blueprintFile( 'p1' ) ) ).toBe( true );
		expect( existsSync( join( root, 'p1', 'interior' ) ) ).toBe( false );
		expect( new OutDir( root ).interiors( PARCELS ) ).toEqual( [] );

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
