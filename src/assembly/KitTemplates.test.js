import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { KitPlacement } from '../game/city/kit/KitPlacement.js';
import { blueprintFile, placementsFile, planPath, PLANS_FOLDER } from './kit/index.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const TINY = fileURLToPath( new URL( '../../../atlas/samples/city-urbe-tiny.json', import.meta.url ) );
const atlas = JSON.parse( readFileSync( TINY, 'utf8' ) );

const roots = [];

/** One whole city, assembled the way the command line does it. */
function assemble( blueprint = TINY, options = [ '--interiors', '0' ] ) {

	const root = mkdtempSync( join( tmpdir(), 'urbe-templates-' ) );

	roots.push( root );

	const run = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', blueprint, '--out', root, ...options ], { cwd: ENGINE_ROOT, encoding: 'utf8' } );

	return {
		root,
		status: run.status,
		stdout: run.stdout,
		stderr: run.stderr,
		report: JSON.parse( readFileSync( join( root, 'qa-report.json' ), 'utf8' ) ),
		manifest: JSON.parse( readFileSync( join( root, 'manifest.json' ), 'utf8' ) ),
		record: ( id ) => JSON.parse( readFileSync( join( root, id, placementsFile( id ) ), 'utf8' ) ),
		plan: ( id ) => JSON.parse( readFileSync( join( root, planPath( id ) ), 'utf8' ) ),
		blueprint: ( id ) => JSON.parse( readFileSync( join( root, id, blueprintFile( id ) ), 'utf8' ) )
	};

}

/** The tiny blueprint with one parcel changed, on disk for the CLI to read. */
function variant( name, parcelId, change ) {

	const document = JSON.parse( readFileSync( TINY, 'utf8' ) );

	Object.assign( document.parcels.find( ( parcel ) => parcel.id === parcelId ), change );

	const path = join( mkdtempSync( join( tmpdir(), `urbe-${name}-` ) ), `${name}.json` );

	roots.push( dirname( path ) );
	writeFileSync( path, JSON.stringify( document ) );

	return path;

}

/** The first block variation that merged two lots: the host and the lot it took. */
function mergedPair( city ) {

	const [ id, record ] = Object.keys( city.manifest.buildings )
		.map( ( parcel ) => [ parcel, city.record( parcel ) ] )
		.find( ( [ , entry ] ) => entry.absorbs ) ?? [];

	return { host: id, absorbed: record?.absorbs, record };

}

/** Which block each parcel belongs to, straight from the blueprint. */
const blockOf = new Map( atlas.blocks.flatMap( ( block ) => block.parcelIds.map( ( id ) => [ id, block ] ) ) );

describe( 'block templates and shared building plans', () => {

	let city = null;

	beforeAll( () => {

		city = assemble();

	}, 300_000 );

	afterAll( () => {

		for ( const root of roots ) rmSync( root, { recursive: true, force: true } );
		roots.length = 0;

	} );

	it( 'dresses every block of one template the same, apart from its own variation', () => {

		const byTemplate = new Map();

		for ( const [ id, entry ] of Object.entries( city.manifest.buildings ) ) {

			if ( entry.template === null ) continue;

			const blocks = byTemplate.get( entry.template ) ?? new Map();
			const slots = blocks.get( blockOf.get( id ).id ) ?? new Map();
			const record = city.record( id );

			slots.set( entry.slot, `${record.family}/${record.floors}` );
			blocks.set( blockOf.get( id ).id, slots );
			byTemplate.set( entry.template, blocks );

		}

		const repeated = [ ...byTemplate.entries() ].filter( ( [ , blocks ] ) => blocks.size > 1 );

		expect( repeated.length ).toBeGreaterThan( 0 );

		for ( const [ template, blocks ] of repeated ) {

			const instances = [ ...blocks.values() ];
			// What the template says, before any block varies: what most of its
			// instances wear in each lot.
			const base = new Map( [ ...new Set( instances.flatMap( ( slots ) => [ ...slots.keys() ] ) ) ]
				.map( ( slot ) => [ slot, commonest( instances.map( ( slots ) => slots.get( slot ) ) ) ] ) );

			for ( const slots of instances ) {

				// One variation per block: one lot's floors moved, or two lots
				// merged into one building and the second left empty.
				const differing = [ ...base.keys() ].filter( ( slot ) => base.get( slot ) !== slots.get( slot ) );

				expect( differing.length, `${template} varies in ${differing.join( ', ' )}` ).toBeLessThanOrEqual( 2 );

			}

		}

	} );

	it( 'merges two lots of a block into one building and leaves the second lot empty', () => {

		const { host: id, absorbed, record } = mergedPair( city );

		expect( id, 'the tiny city has a merged block' ).toBeTruthy();

		const plan = city.plan( record.plan );
		const covered = ( plan.baysAcross + plan.baysDeep ) * 8 * 2;
		const own = atlas.parcels.find( ( parcel ) => parcel.id === id ).lot;
		const perimeter = ( ring ) => Math.max( ...ring.map( ( p ) => p[ 0 ] ) ) - Math.min( ...ring.map( ( p ) => p[ 0 ] ) )
			+ Math.max( ...ring.map( ( p ) => p[ 1 ] ) ) - Math.min( ...ring.map( ( p ) => p[ 1 ] ) );

		// One building over two lots: its plan covers more ground than its own lot.
		expect( covered ).toBeGreaterThan( perimeter( own ) * 2 );
		expect( blockOf.get( absorbed ).id ).toBe( blockOf.get( id ).id );
		expect( existsSync( join( city.root, absorbed ) ) ).toBe( false );
		expect( city.manifest.parcels ).not.toContain( absorbed );
		expect( city.manifest.sources[ absorbed ] ).toBe( 'empty' );

	} );

	it( 'plans each distinct building once and gives a parcel only its own frame', () => {

		const { totals } = city.report;
		const kits = Object.keys( city.manifest.buildings );

		expect( totals.kit ).toBe( kits.length );
		expect( totals.plans ).toBeLessThan( totals.kit );
		expect( readdirSync( join( city.root, PLANS_FOLDER ) ) ).toHaveLength( totals.plans );

		for ( const id of kits ) {

			expect( statSync( join( city.root, id, placementsFile( id ) ) ).size ).toBeLessThan( 1024 );

		}

	} );

	it( 'places the plan where Exterior planned the same building on the parcel', () => {

		const id = Object.keys( city.manifest.buildings ).find( ( parcel ) => city.plan( city.record( parcel ).plan ).signAnchors.length );
		const record = city.record( id );
		const plan = city.plan( record.plan );
		const blueprint = city.blueprint( id );
		const placement = new KitPlacement( id, record, plan, { bay: 8 } );
		const anchors = plan.signAnchors.map( ( anchor ) => placement.point( ...anchor.position ).toArray() );
		const published = [ ...blueprint.signage, ...blueprint.screens ].map( ( field ) => field.center );

		// The blueprint carries the same anchors in world metres, written from the
		// plan Exterior drew on the parcel itself.
		expect( anchors ).toHaveLength( published.length );
		for ( const [ index, anchor ] of anchors.entries() ) {

			for ( const axis of [ 0, 1, 2 ] ) expect( anchor[ axis ] ).toBeCloseTo( published[ index ][ axis ], 6 );

		}

		// And every piece copy stands inside the ground the blueprint publishes.
		const ring = blueprint.bounds.footprint;
		const box = {
			x: [ Math.min( ...ring.map( ( p ) => p[ 0 ] ) ), Math.max( ...ring.map( ( p ) => p[ 0 ] ) ) ],
			z: [ Math.min( ...ring.map( ( p ) => p[ 1 ] ) ), Math.max( ...ring.map( ( p ) => p[ 1 ] ) ) ]
		};

		for ( const piece of placement.placements ) {

			const world = placement.matrixOf( piece );
			const [ x, , z ] = [ world.elements[ 12 ], world.elements[ 13 ], world.elements[ 14 ] ];

			expect( x ).toBeGreaterThanOrEqual( box.x[ 0 ] - 1e-6 );
			expect( x ).toBeLessThanOrEqual( box.x[ 1 ] + 1e-6 );
			expect( z ).toBeGreaterThanOrEqual( box.z[ 0 ] - 1e-6 );
			expect( z ).toBeLessThanOrEqual( box.z[ 1 ] + 1e-6 );

		}

	} );

	it( 'publishes an empty lot for a parcel that cannot be built, and still stands the city', () => {

		const broken = JSON.parse( readFileSync( TINY, 'utf8' ) ).parcels[ 3 ].id;
		// A lot no floor count fits: the kit passes it over and the generator refuses it.
		const run = assemble( variant( 'broken', broken,
			{ envelope: { minFloors: 1, maxFloors: 1, floorHeight: 4.5, maxHeight: 1 } } ) );
		const record = run.report.parcels.find( ( parcel ) => parcel.parcelId === broken );

		expect( run.status, run.stderr ).toBe( 0 );
		expect( record ).toMatchObject( { source: 'empty', type: expect.any( String ), tier: expect.any( String ) } );
		expect( record.error ).toContain( 'E_ENVELOPE_INFEASIBLE' );
		expect( record.lot.width ).toBeGreaterThan( 0 );
		expect( existsSync( join( run.root, broken ) ) ).toBe( false );
		// The one list the game loads never names it, so nothing is ever fetched for it.
		expect( run.manifest.parcels ).not.toContain( broken );
		expect( run.manifest.sources[ broken ] ).toBe( 'empty' );
		expect( run.manifest.parcels.length ).toBeGreaterThan( 30 );

	}, 300_000 );

	it( 'leaves a merged lot its own building when the neighbour that absorbed it stands none', () => {

		const { host, absorbed } = mergedPair( city );
		const run = assemble( variant( 'landmark', host, { landmark: true } ) );
		const record = run.report.parcels.find( ( parcel ) => parcel.parcelId === absorbed );

		// The landmark keeps its own lot, so nothing covers its neighbour any more.
		expect( run.status, run.stderr ).toBe( 0 );
		expect( run.manifest.buildings[ host ] ).toBeUndefined();
		expect( record ).toMatchObject( { ok: true, source: 'shell' } );
		expect( record.mergedInto ).toBeUndefined();
		expect( run.manifest.parcels ).toContain( absorbed );
		expect( run.manifest.sources[ absorbed ] ).toBe( 'shell' );

	}, 300_000 );

	it( 'publishes the city when a manually selected interior has no building to open', () => {

		const { absorbed } = mergedPair( city );
		const open = Object.keys( city.manifest.buildings ).find( ( id ) => city.record( id ).floors >= 3 );
		const run = assemble( TINY, [ '--interior-parcels', `${absorbed},${open}` ] );

		expect( run.status, run.stderr ).toBe( 0 );
		expect( run.report.interiorFailures ).toContainEqual( {
			parcelId: absorbed, error: 'E_INTERIOR_SELECTION: no building stands on this parcel'
		} );
		// The rest of the selection still opened, and the world is published.
		expect( run.manifest.interiors ).toEqual( [ open ] );
		expect( run.report.totals.interiorsRequested ).toBe( 2 );

	}, 300_000 );

	it( 'gives the same blueprint the same city, byte for byte', () => {

		const again = assemble();

		for ( const id of Object.keys( city.manifest.buildings ) ) {

			expect( readFileSync( join( again.root, id, placementsFile( id ) ) )
				.equals( readFileSync( join( city.root, id, placementsFile( id ) ) ) ) ).toBe( true );

		}

		for ( const name of readdirSync( join( city.root, PLANS_FOLDER ) ) ) {

			expect( readFileSync( join( again.root, PLANS_FOLDER, name ) )
				.equals( readFileSync( join( city.root, PLANS_FOLDER, name ) ) ) ).toBe( true );

		}

	}, 300_000 );

} );

/** The value most of a template's blocks agree on for one lot. */
function commonest( values ) {

	const counted = new Map();

	for ( const value of values ) counted.set( value, ( counted.get( value ) ?? 0 ) + 1 );

	return [ ...counted ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ][ 0 ];

}
