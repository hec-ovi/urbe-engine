import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestAssembler } from '../RequestAssembler.js';
import { ExteriorWorkers } from '../ExteriorWorkers.js';
import { validateExteriorBlueprint } from '../validators.js';
import { sharedRoot } from '../SharedResources.js';
import {
	KitAssembler, PlanLibrary, PlanFrame, blueprintFile, fittingFamilies, parcelBlueprint, placementsFile,
	planBlueprintFile, planGlbFile, PLAN_INDEX_FILE, schemaMessage, validateKitPlacements, validatePlanIndex
} from './index.js';

const atlas = JSON.parse( readFileSync( fileURLToPath( new URL( '../kit-city.fixture.json', import.meta.url ) ), 'utf8' ) );
const roots = [];

/** The error code a call reports, so a test names the contract's code exactly. */
function failure( run ) {

	try {

		run();
		return null;

	} catch ( error ) {

		return error.code;

	}

}

function scratch() {

	const root = mkdtempSync( join( tmpdir(), 'urbe-kit-' ) );

	roots.push( root );

	return root;

}

/**
 * The plan with an antenna on its roof: which buildings carry one is Exterior's
 * choice, and the points a city fits its rooftop cables between are this mast's.
 */
function withMast( plan ) {

	const ring = plan.bounds.footprint;
	const x = ring.reduce( ( sum, point ) => sum + point[ 0 ], 0 ) / ring.length;
	const z = ring.reduce( ( sum, point ) => sum + point[ 1 ], 0 ) / ring.length;
	const foot = plan.roof.elevation;
	const top = foot + 5;
	const corner = ( dx, dz ) => ( { from: [ x + dx, foot, z + dz ], to: [ x, foot + 1, z ] } );

	return { ...plan, roof: { ...plan.roof, artifacts: [ ...plan.roof.artifacts ?? [], {
		id: 'roof-artifact:antenna:0', kind: 'antenna', center: [ x, z ], size: [ 1, 1, 5 ], rotationDeg: 30,
		mastAssembly: {
			variant: 'crossarm-mast',
			mast: { from: [ x, foot, z ], to: [ x, top, z ] },
			arms: [ { from: [ x, top - 1, z ], to: [ x + 0.5, top - 1, z ] } ],
			supports: [ corner( 0.5, 0.5 ), corner( 0.5, - 0.5 ), corner( - 0.5, 0.5 ), corner( - 0.5, - 0.5 ) ],
			cableAttachments: [ [ x + 0.5, top - 1, z ] ],
			cables: [ { id: 'cable:0', path: [ [ x + 0.5, top - 1, z ], [ x, top, z ] ] } ],
			externalAttachments: [ {
				id: 'roof-artifact:antenna:0:external:0', position: [ x, top, z ],
				orientation: 'directional', normal: [ 1, 0, 0 ], clearanceRadius: 0.1
			} ]
		}
	} ] } };

}

/** One parcel standing a plan in the frame given, as KitAssembler records it. */
function placed( parcel, plan, frame ) {

	const ring = new PlanFrame( frame ).ring( plan.bounds.footprint );
	const xs = ring.map( ( point ) => point[ 0 ] );
	const zs = ring.map( ( point ) => point[ 1 ] );

	return { parcel, ...frame, bounds: {
		min: [ Math.min( ...xs ), 0, Math.min( ...zs ) ],
		max: [ Math.max( ...xs ), plan.bounds.height, Math.max( ...zs ) ]
	} };

}

describe( 'kit assembly', () => {

	let workers = null;
	let plans = null;
	let kit = null;

	beforeAll( async () => {

		workers = new ExteriorWorkers( 2 );
		plans = new PlanLibrary( { workers } );
		kit = new KitAssembler( atlas, new RequestAssembler( atlas, { apertures: [] } ), plans );
		kit.candidate( 'p1' );
		kit.candidate( 'p2' );
		await plans.draw();

	}, 300_000 );

	afterAll( async () => {

		await workers.close();
		for ( const root of roots ) rmSync( root, { recursive: true, force: true } );
		roots.length = 0;

	} );

	it( 'stands ordinary parcels on a shared plan and leaves landmarks to the generator', () => {

		expect( kit.candidate( 'p0' ) ).toBe( null );
		expect( kit.reasons.get( 'p0' ) ).toBe( 'landmark' );
		expect( failure( () => kit.build( 'p0', tmpdir() ) ) ).toBe( 'E_KIT_FIT' );
		// Both parcels are mid tier, so neither wears an approved family.
		expect( kit.candidate( 'p1' ).plan.family ).toBe( null );

	} );

	it( 'writes a record of the frame alone, over any shell that stood there, the same bytes every time', () => {

		const build = ( parcelId, stale = {} ) => {

			const root = scratch();
			const parcelDir = join( root, parcelId );

			mkdirSync( parcelDir, { recursive: true } );
			for ( const [ name, content ] of Object.entries( stale ) ) writeFileSync( join( parcelDir, name ), content );

			return { record: kit.build( parcelId, parcelDir ), parcelDir };

		};

		const first = build( 'p1', { 'p1.glb': 'stale geometry', 'p1.request.json': '{}', 'p1.blueprint.json': '{}' } );
		const second = build( 'p1' );
		const wide = build( 'p2' );
		const bytes = ( built ) => readFileSync( join( built.parcelDir, placementsFile( built.record.parcel ) ) );
		const blueprint = parcelBlueprint( plans.blueprint( first.record.plan ), first.record );

		expect( schemaMessage( validateKitPlacements( first.record ) ) ).toBe( '' );
		expect( schemaMessage( validateExteriorBlueprint( blueprint ) ) ).toBe( '' );
		expect( blueprint.buildingId ).toBe( 'p1' );
		expect( first.record.signText ).toBe( 'CAFE DEL SUR' );

		// The folder holds one building: the geometry and the blueprint of the
		// shell it replaced are gone, and the parcel is its frame alone.
		for ( const name of [ 'p1.glb', 'p1.request.json', blueprintFile( 'p1' ) ] ) {

			expect( existsSync( join( first.parcelDir, name ) ) ).toBe( false );

		}
		expect( bytes( first ).byteLength ).toBeLessThan( 1024 );
		expect( bytes( second ).equals( bytes( first ) ) ).toBe( true );

		// A 40 by 56 m lot is five bays by seven, drawn for the offices on it,
		// and its massing stands on them.
		expect( [ wide.record.plan ] ).toEqual( [ 'plain-offices-mid-5x7x4f' ] );
		expect( wide.record.bounds.max[ 0 ] - wide.record.bounds.min[ 0 ] ).toBeLessThanOrEqual( 40 );
		expect( wide.record.bounds.max[ 2 ] - wide.record.bounds.min[ 2 ] ).toBeLessThanOrEqual( 56 );

	} );

	it( 'stands a roof mast on the parcel it belongs to, cables and all', () => {

		const plan = withMast( plans.blueprint( kit.candidate( 'p1' ).plan.id ) );
		const mast = plan.roof.artifacts.at( - 1 ).mastAssembly;
		// Both fixture parcels front a street on -z, so they stand unturned: a
		// quarter turn is what tells a composed point from a plan-local one.
		const record = placed( 'p1', plan, { origin: [ 300, 0, 120 ], rotationY: - Math.PI / 2 } );
		const frame = new PlanFrame( record );
		const composed = parcelBlueprint( plan, record );
		const fitted = composed.roof.artifacts.at( - 1 ).mastAssembly;
		const attachments = fitted.externalAttachments.map( ( attachment ) => attachment.position );

		expect( schemaMessage( validateExteriorBlueprint( composed ) ) ).toBe( '' );
		expect( attachments ).toEqual( mast.externalAttachments.map( ( attachment ) => frame.point3( attachment.position ) ) );
		expect( fitted.externalAttachments.map( ( attachment ) => attachment.normal ) )
			.toEqual( mast.externalAttachments.map( ( attachment ) => frame.direction3( attachment.normal ) ) );
		expect( fitted.mast ).toEqual( { from: frame.point3( mast.mast.from ), to: frame.point3( mast.mast.to ) } );
		expect( fitted.cableAttachments ).toEqual( mast.cableAttachments.map( ( point ) => frame.point3( point ) ) );
		expect( fitted.cables.map( ( cable ) => cable.path ) )
			.toEqual( mast.cables.map( ( cable ) => cable.path.map( ( point ) => frame.point3( point ) ) ) );

		// The city fits its rooftop cables between these points, so each one has
		// to stand over this building: on its footprint, above its roof.
		for ( const [ x, y, z ] of attachments ) {

			expect( x ).toBeGreaterThanOrEqual( record.bounds.min[ 0 ] );
			expect( x ).toBeLessThanOrEqual( record.bounds.max[ 0 ] );
			expect( z ).toBeGreaterThanOrEqual( record.bounds.min[ 2 ] );
			expect( z ).toBeLessThanOrEqual( record.bounds.max[ 2 ] );
			expect( y ).toBeGreaterThan( plan.roof.elevation );

		}

	} );

	it( 'generates a plan once and lets every parcel of it stand on that one shell', () => {

		for ( const id of plans.plans.keys() ) {

			expect( existsSync( join( plans.folder( id ), planGlbFile( id ) ) ) ).toBe( true );
			expect( existsSync( join( plans.folder( id ), planBlueprintFile( id ) ) ) ).toBe( true );

		}

		// A second run over the same buildings draws nothing at all.
		expect( plans.draw() ).resolves.toMatchObject( { drawn: 0 } );

	} );

	it( 'publishes an index of the plans its buildings stand on and refuses one the store lost', () => {

		const used = [ ...plans.plans.keys() ];
		const reference = plans.publish( used );
		const index = JSON.parse( readFileSync( join( sharedRoot(), reference.shared, PLAN_INDEX_FILE ), 'utf8' ) );

		expect( reference.file ).toBe( PLAN_INDEX_FILE );
		expect( schemaMessage( validatePlanIndex( index ) ) ).toBe( '' );
		expect( index.plans.map( ( plan ) => plan.id ) ).toEqual( [ ...used ].sort() );
		expect( failure( () => plans.publish( [ ...used, 'white-grid-3x3x4f' ] ) ) ).toBe( 'E_KIT_PLANS' );

	} );

	it( 'keeps corporate sectors off small or short lots and every luxury family off mid and poor streets', () => {

		const bays = ( across, deep ) => ( { across, deep } );

		expect( fittingFamilies( bays( 5, 5 ), 12, { type: 'corpo', tier: 'high_rich' } ) ).toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 4, 5 ), 12, { type: 'corpo', tier: 'high_rich' } ) ).not.toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 5, 5 ), 11, { type: 'corpo', tier: 'high_rich' } ) ).not.toContain( 'corporate-sectors' );
		expect( fittingFamilies( bays( 5, 5 ), 12, { type: 'residential', tier: 'rich' } ) ).not.toContain( 'corporate-sectors' );

		for ( const tier of [ 'mid', 'poor' ] ) {

			expect( fittingFamilies( bays( 7, 7 ), 20, { type: 'residential', tier } ) ).toEqual( [] );

		}
		expect( fittingFamilies( bays( 7, 7 ), 20, { type: 'residential', tier: 'rich' } ) )
			.toEqual( [ 'balcony-grid', 'faceted-bays', 'mirror-frame', 'mirror-shutters', 'white-grid' ] );

	} );

} );
