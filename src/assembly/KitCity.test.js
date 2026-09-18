import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import AjvModule from 'ajv/dist/2020.js';
import { OutDir } from './OutDir.js';
import { SchemaFiles } from './SchemaFiles.js';
import { InteriorModules, MODULES_FILE, PROPS_FILE } from './InteriorModules.js';
import { sharedRoot } from './SharedResources.js';
import { collectShellArtifacts } from './ShellArtifacts.js';
import { validateExteriorBlueprint } from './validators.js';
import { BuildingBlueprints } from './BuildingBlueprints.js';
import { PlanLibrary } from './kit/PlanLibrary.js';
import { blueprintFile, placementsFile, planGlbFile, PLAN_INDEX_FILE, schemaMessage, validateKitPlacements } from './kit/index.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const BLUEPRINT = fileURLToPath( new URL( './kit-city.fixture.json', import.meta.url ) );
const atlas = JSON.parse( readFileSync( BLUEPRINT, 'utf8' ) );
const PARCELS = atlas.parcels.map( ( parcel ) => parcel.id );

/**
 * One city run. Native streets currently refuse this Atlas version, which ends
 * the run after every building is on disk and its report is written, so the
 * exit status belongs to that step and not to the buildings.
 */
function assembleCity( out, { modulesDir = null, options = [ '--interiors', '0' ] } = {} ) {

	const env = { ...process.env };

	if ( modulesDir ) env.URBE_INTERIOR_MODULES_DIR = modulesDir;

	const run = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', BLUEPRINT, '--out', out, '--keep-shared', ...options ], { cwd: ENGINE_ROOT, encoding: 'utf8', env } );
	const reportPath = join( out, 'qa-report.json' );

	return {
		stdout: run.stdout,
		stderr: run.stderr,
		report: existsSync( reportPath ) ? JSON.parse( readFileSync( reportPath, 'utf8' ) ) : null,
		file: ( parcelId, name ) => readFileSync( join( out, parcelId, name ) ),
		has: ( parcelId, name ) => existsSync( join( out, parcelId, name ) )
	};

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

	it( 'stands ordinary parcels on shared plans, generates the landmark and publishes the world they make', async () => {

		const { root, report, has, file } = city();
		const library = new PlanLibrary( { workers: null } );
		const blueprints = new BuildingBlueprints( root, library );

		expect( report.totals ).toMatchObject( { parcels: 3, passed: 3, failed: 0, kit: 2, generated: 1, plans: 2 } );
		expect( report.parcels.map( ( parcel ) => [ parcel.parcelId, parcel.source ] ) )
			.toEqual( [ [ 'p0', 'shell' ], [ 'p1', 'kit' ], [ 'p2', 'kit' ] ] );

		// The landmark is generated, so it keeps its own geometry and its own blueprint.
		expect( has( 'p0', 'p0.glb' ) ).toBe( true );
		expect( has( 'p0', blueprintFile( 'p0' ) ) ).toBe( true );
		expect( has( 'p0', placementsFile( 'p0' ) ) ).toBe( false );

		for ( const parcelId of [ 'p1', 'p2' ] ) {

			expect( has( parcelId, `${parcelId}.glb` ) ).toBe( false );
			// A kit parcel is its frame alone; its building belongs to its plan.
			expect( has( parcelId, blueprintFile( parcelId ) ) ).toBe( false );
			const record = JSON.parse( file( parcelId, placementsFile( parcelId ) ).toString( 'utf8' ) );
			const blueprint = await blueprints.of( parcelId );

			expect( schemaMessage( validateKitPlacements( record ) ) ).toBe( '' );
			expect( schemaMessage( validateExteriorBlueprint( blueprint ) ) ).toBe( '' );
			expect( existsSync( join( library.folder( record.plan ), planGlbFile( record.plan ) ) ) ).toBe( true );
			expect( existsSync( library.blueprintPath( record.plan ) ) ).toBe( true );
			expect( record.parcel ).toBe( parcelId );
			expect( blueprint.buildingId ).toBe( parcelId );

		}

		// The world references the shared shells instead of carrying any geometry.
		expect( existsSync( join( root, 'kit' ) ) ).toBe( false );

		const out = new OutDir( root );
		const shells = out.shells( PARCELS );
		const kits = out.kits( shells );
		const { catalog } = await collectShellArtifacts( root, shells, { seed: atlas.meta.seed, plans: library } );
		const reference = library.publish( report.plans );
		const manifest = await out.publishManifest( atlas, shells, [], {
			catalog, kit: reference,
			sources: Object.fromEntries( shells.map( ( id ) => [ id, kits.includes( id ) ? 'kit' : 'shell' ] ) )
		} );
		const index = JSON.parse( readFileSync( join( sharedRoot(), reference.shared, PLAN_INDEX_FILE ), 'utf8' ) );

		expect( shells ).toEqual( PARCELS );
		expect( kits ).toEqual( [ 'p1', 'p2' ] );
		expect( manifest.kit ).toEqual( reference );
		expect( index.plans.map( ( plan ) => plan.id ) ).toEqual( report.plans );
		expect( manifest.sources ).toEqual( { p0: 'shell', p1: 'kit', p2: 'kit' } );
		expect( catalog.buildings.map( ( building ) => building.id ) ).toEqual( PARCELS );

		const p1 = catalog.buildings.find( ( building ) => building.id === 'p1' );
		const record = JSON.parse( readFileSync( join( root, 'p1', placementsFile( 'p1' ) ), 'utf8' ) );

		expect( p1.floorCount ).toBe( record.floors );
		expect( p1.bounds ).toEqual( record.bounds );

	}, 300_000 );

	it( 'furnishes a kit parcel from the plan it stands on and binds the shared module and furniture sets', async () => {

		const { root, report, has, file } = city( { options: [ '--interior-parcels', 'p1' ] } );
		const p1 = report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' );

		expect( report.totals ).toMatchObject( { interiorsRequested: 1, interiorsReady: 1, interiorsFailed: 0 } );
		expect( p1 ).toMatchObject( { source: 'kit', interior: 'ready', coreMode: 'standard' } );
		// The building it was furnished from is the one that stands: its plan.
		expect( has( 'p1', placementsFile( 'p1' ) ) ).toBe( true );
		expect( has( 'p1', 'p1.glb' ) ).toBe( false );

		const interior = ( name ) => JSON.parse( file( 'p1', join( 'interior', name ) ).toString( 'utf8' ) );
		const building = interior( 'building.json' );

		expect( interiorSchemas( 'https://urbe.dev/interior/building.schema.json', building ) ).toBe( '' );
		expect( Object.keys( building.layouts ).sort() ).toEqual( [ 'crown', 'ground', 'middle' ] );
		expect( building.floors.map( ( floor ) => floor.index ) ).toEqual( [ 0, 1, 2 ] );
		for ( const layout of Object.values( building.layouts ) ) {

			expect( interiorSchemas( 'https://urbe.dev/interior/floor-placement.schema.json', interior( layout ) ) ).toBe( '' );

		}
		expect( interiorSchemas( 'urbe/interior/npc', interior( 'npc.json' ) ) ).toBe( '' );

		const out = new OutDir( root );
		const shells = out.shells( PARCELS );
		const references = await new InteriorModules().publish();
		const modules = join( sharedRoot(), references.modules.shared );
		const props = join( sharedRoot(), references.props.shared );
		const manifest = await out.publishManifest( atlas, shells, out.interiors( shells ), {
			interiorModules: references.modules, interiorProps: references.props
		} );

		// The world names both sets by their bytes and carries neither.
		expect( manifest.interiorModules ).toEqual( references.modules );
		expect( manifest.interiorProps ).toEqual( references.props );
		expect( existsSync( join( root, 'interior-modules' ) ) ).toBe( false );
		expect( manifest.interiors ).toEqual( [ 'p1' ] );
		expect( manifest.floors.p1 ).toEqual( [ '000', '001', '002' ] );
		expect( JSON.parse( readFileSync( join( modules, MODULES_FILE ), 'utf8' ) ).modules.length ).toBeGreaterThan( 0 );

		// building.json names both catalogs against one resource base, so both stand there,
		// and every furniture model a placement can name travelled with the catalog.
		const catalog = JSON.parse( readFileSync( join( props, PROPS_FILE ), 'utf8' ) );
		const models = catalog.assets.filter( ( asset ) => asset.modelUri );

		expect( building.modules ).toBe( MODULES_FILE );
		expect( building.props ).toBe( PROPS_FILE );
		expect( models.length ).toBeGreaterThan( 0 );
		for ( const asset of models ) expect( existsSync( join( props, asset.modelUri ) ) ).toBe( true );

	}, 120_000 );

	it( 'keeps the building closed and standing when its interior fails', () => {

		const modulesDir = scratch();

		writeFileSync( join( modulesDir, 'modules.json' ), '{"version":1,"grid":0.5}' );
		const { root, report, has } = city( { modulesDir, options: [ '--interior-parcels', 'p1' ] } );

		expect( report.totals ).toMatchObject( { passed: 3, failed: 0, interiorsReady: 0, interiorsFailed: 1 } );
		expect( report.interiorFailures[ 0 ].error ).toContain( 'E_INTERIOR_FAILED' );
		expect( report.parcels.find( ( parcel ) => parcel.parcelId === 'p1' ).interior ).toBe( 'closed' );
		// The shell still stands, closed: its record and its plan are untouched.
		expect( has( 'p1', placementsFile( 'p1' ) ) ).toBe( true );
		expect( existsSync( join( root, 'p1', 'interior' ) ) ).toBe( false );
		expect( new OutDir( root ).interiors( PARCELS ) ).toEqual( [] );

	}, 120_000 );

} );
