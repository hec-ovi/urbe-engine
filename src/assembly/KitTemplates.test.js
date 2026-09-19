import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { openingRect } from '../game/city/Openings.js';
import { sharedRoot } from './SharedResources.js';
import { blueprintFile, fittingFamilies, parcelBlueprint, placementsFile, PLAN_INDEX_FILE } from './kit/index.js';

const ENGINE_ROOT = resolve( dirname( fileURLToPath( import.meta.url ) ), '../..' );
const TINY = fileURLToPath( new URL( '../../../atlas/samples/city-urbe-tiny.json', import.meta.url ) );
const atlas = JSON.parse( readFileSync( TINY, 'utf8' ) );
/** Every point of a composed building has to land where the plan puts it. */
const MILLIMETRE = 0.001;

const roots = [];

/** One whole city, assembled the way the command line does it. */
function assemble( blueprint = TINY, options = [ '--interiors', '0' ] ) {

	const root = mkdtempSync( join( tmpdir(), 'urbe-templates-' ) );

	roots.push( root );

	const run = spawnSync( process.execPath, [ '--import', 'tsx', 'src/assembly/city-cli.js',
		'--blueprint', blueprint, '--out', root, ...options ], { cwd: ENGINE_ROOT, encoding: 'utf8' } );
	const manifest = JSON.parse( readFileSync( join( root, 'manifest.json' ), 'utf8' ) );
	const index = JSON.parse( readFileSync( join( sharedRoot(), manifest.kit.shared, PLAN_INDEX_FILE ), 'utf8' ) );
	const plans = new Map( index.plans.map( ( plan ) => [ plan.id, plan ] ) );
	const record = ( id ) => JSON.parse( readFileSync( join( root, id, placementsFile( id ) ), 'utf8' ) );
	const planBlueprint = ( id ) => JSON.parse( readFileSync( join( sharedRoot(), plans.get( id ).blueprint ), 'utf8' ) );

	return {
		root,
		status: run.status,
		stdout: run.stdout,
		stderr: run.stderr,
		report: JSON.parse( readFileSync( join( root, 'qa-report.json' ), 'utf8' ) ),
		manifest,
		plans,
		record,
		planBlueprint,
		// What a consumer gets for one parcel: its plan's blueprint in its frame.
		blueprint: ( id ) => parcelBlueprint( planBlueprint( record( id ).plan ), record( id ) )
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

/** Which block each parcel belongs to, straight from the blueprint. */
const blockOf = new Map( atlas.blocks.flatMap( ( block ) => block.parcelIds.map( ( id ) => [ id, block ] ) ) );

describe( 'block templates and shared building plans', () => {

	let city = null;

	beforeAll( () => {

		city = assemble();

	}, 600_000 );

	afterAll( () => {

		for ( const root of roots ) rmSync( root, { recursive: true, force: true } );
		roots.length = 0;

	} );

	it( 'dresses every slot of one template with one design and gives each block one variation', () => {

		const templates = new Map();

		for ( const [ id, entry ] of Object.entries( city.manifest.buildings ) ) {

			if ( entry.template === null ) continue;

			const template = templates.get( entry.template )
				?? { slots: new Map(), merges: new Map(), blocks: new Set() };
			const record = city.record( id );
			const block = blockOf.get( id ).id;

			template.blocks.add( block );

			// A merged building covers two slots and wears a design of its own,
			// which is the one variation its block takes; the lot it took over
			// ships nothing and stands in no slot.
			if ( record.absorbs ) template.merges.set( block, ( template.merges.get( block ) ?? 0 ) + 1 );
			else template.slots.set( entry.slot, ( template.slots.get( entry.slot ) ?? new Set() ).add( record.family ) );

			templates.set( entry.template, template );

		}

		const repeated = [ ...templates.values() ].filter( ( template ) => template.blocks.size > 1 );

		expect( repeated.length ).toBeGreaterThan( 0 );

		for ( const template of repeated ) {

			// Every block of the template reads the same: one design per lot,
			// each standing the height its own envelope allows.
			for ( const [ slot, families ] of template.slots ) expect( [ ...families ], `slot ${slot}` ).toHaveLength( 1 );
			for ( const [ block, merged ] of template.merges ) expect( merged, block ).toBe( 1 );

		}

	} );

	it( 'generates each distinct building once and stands every parcel of it on that one shell', () => {

		const { totals } = city.report;
		const kits = Object.keys( city.manifest.buildings );
		const standing = new Map();

		for ( const id of kits ) {

			const record = city.record( id );

			standing.set( record.plan, ( standing.get( record.plan ) ?? 0 ) + 1 );
			// A parcel is its frame alone: a city's building data grows with its
			// distinct buildings, not with its lots.
			expect( statSync( join( city.root, id, placementsFile( id ) ) ).size ).toBeLessThan( 1024 );
			expect( existsSync( join( city.root, id, blueprintFile( id ) ) ) ).toBe( false );
			expect( existsSync( join( city.root, id, `${id}.glb` ) ) ).toBe( false );

		}

		expect( totals.kit ).toBe( kits.length );
		expect( totals.plans ).toBeLessThan( totals.kit );
		expect( standing.size ).toBe( totals.plans );
		// At least one building really is repeated, and every plan named has one
		// shell and one blueprint in the shared store.
		expect( Math.max( ...standing.values() ) ).toBeGreaterThan( 1 );
		for ( const id of standing.keys() ) {

			const plan = city.plans.get( id );

			expect( statSync( join( sharedRoot(), plan.glb ) ).size ).toBe( plan.bytes );
			expect( existsSync( join( sharedRoot(), plan.blueprint ) ) ).toBe( true );

		}

	} );

	it( 'stands every family it registered on a building that family fits', () => {

		const parcelsById = new Map( atlas.parcels.map( ( parcel ) => [ parcel.id, parcel ] ) );
		const dressed = Object.keys( city.manifest.buildings ).map( ( id ) => city.record( id ) );

		expect( dressed.some( ( record ) => record.family ) ).toBe( true );

		for ( const record of dressed ) {

			if ( ! record.family ) continue;

			const plan = city.plans.get( record.plan );
			const bays = { across: plan.baysAcross, deep: plan.baysDeep };
			// A building covers its own lot and any lot its block's merge gave it,
			// so every use standing under it has to accept the family it wears.
			for ( const id of [ record.parcel, record.absorbs ].filter( Boolean ) ) {

				expect( fittingFamilies( bays, record.floors, parcelsById.get( id ) ), `${record.parcel} ${record.plan}` )
					.toContain( record.family );

			}

		}

	} );

	it( 'merges two lots of a block into one building and leaves the second lot empty', () => {

		const [ id, record ] = Object.keys( city.manifest.buildings )
			.map( ( parcel ) => [ parcel, city.record( parcel ) ] )
			.find( ( [ , entry ] ) => entry.absorbs ) ?? [];

		expect( id, 'the tiny city has a merged block' ).toBeTruthy();

		const absorbed = record.absorbs;
		const plan = city.plans.get( record.plan );
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

	it( 'composes every door and window of a shared building exactly where its frame puts it', () => {

		const records = Object.keys( city.manifest.buildings ).map( ( id ) => city.record( id ) );
		const shared = records.filter( ( record ) => record.plan === commonest( records.map( ( entry ) => entry.plan ) ) );
		// Two parcels of one building in different places, and one of every way a
		// lot can be turned, so the frame is exercised over all four faces.
		const turned = [ ...new Map( records.map( ( record ) => [ record.rotationY, record ] ) ).values() ];

		expect( shared.length ).toBeGreaterThan( 1 );
		expect( new Set( shared.map( ( record ) => record.origin.join() ) ).size ).toBe( shared.length );
		expect( turned.length ).toBe( 4 );

		for ( const record of [ ...shared.slice( 0, 2 ), ...turned ] ) {

			const id = record.parcel;
			const composed = city.blueprint( id );
			const plan = city.planBlueprint( record.plan );
			const placed = openings( composed );
			// The same openings the plan draws, moved into this parcel's frame.
			const drawn = openings( plan ).map( ( entry ) => ( { ...entry, corner: placedAt( entry.corner, record ) } ) );

			expect( composed.buildingId ).toBe( id );
			expect( composed.floors.map( ( floor ) => floor.kind ) ).toEqual( plan.floors.map( ( floor ) => floor.kind ) );
			expect( placed.map( ( entry ) => entry.id ) ).toEqual( drawn.map( ( entry ) => entry.id ) );
			expect( placed.some( ( entry ) => entry.kind === 'door' ) ).toBe( true );
			expect( placed.some( ( entry ) => entry.kind === 'window' ) ).toBe( true );

			for ( const [ at, entry ] of placed.entries() ) {

				for ( const axis of entry.corner.keys() ) {

					expect( Math.abs( entry.corner[ axis ] - drawn[ at ].corner[ axis ] ), `${id} ${entry.id} axis ${axis}` )
						.toBeLessThanOrEqual( MILLIMETRE );

				}

			}

		}

	}, 300_000 );

	it( 'publishes an empty lot for a parcel that cannot be built, and still stands the city', () => {

		const broken = atlas.parcels[ 3 ].id;
		// A lot no floor count fits: the plan passes it over and the generator refuses it.
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

	}, 600_000 );

} );

/** Every opening of a building, as the rectangle it cuts, in document order. */
function openings( blueprint ) {

	return blueprint.floors.flatMap( ( floor ) => ( floor.openings ?? [] ).map( ( opening ) => {

		const rect = openingRect( floor, opening );

		return {
			id: `${floor.index}/${opening.id}`,
			kind: opening.kind,
			corner: [ rect.start.x, rect.start.z, rect.end.x, rect.end.z, rect.y0, rect.y1 ]
		};

	} ) );

}

/** One plan-frame opening rectangle in the frame one parcel stands in. */
function placedAt( [ startX, startZ, endX, endZ, y0, y1 ], { origin, rotationY } ) {

	const cos = Math.cos( rotationY );
	const sin = Math.sin( rotationY );
	const at = ( x, z ) => [ origin[ 0 ] + x * cos + z * sin, origin[ 2 ] - x * sin + z * cos ];
	const [ worldStartX, worldStartZ ] = at( startX, startZ );
	const [ worldEndX, worldEndZ ] = at( endX, endZ );

	return [ worldStartX, worldStartZ, worldEndX, worldEndZ, origin[ 1 ] + y0, origin[ 1 ] + y1 ];

}

/** The value most of a template's blocks agree on for one lot. */
function commonest( values ) {

	const counted = new Map();

	for ( const value of values ) counted.set( value, ( counted.get( value ) ?? 0 ) + 1 );

	return [ ...counted ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ][ 0 ];

}
