import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RequestAssembler } from '../RequestAssembler.js';
import { validateExteriorBlueprint } from '../validators.js';
import { KitAssembler, KitManifest, blueprintFile, placementsFile, planPath, schemaMessage, validateKitPlacements, validateKitPlan } from './index.js';

const atlas = JSON.parse( readFileSync( fileURLToPath( new URL( '../kit-city.fixture.json', import.meta.url ) ), 'utf8' ) );

/** The error code a call reports, so a test names the contract's code exactly. */
function failure( run ) {

	try {

		run();
		return null;

	} catch ( error ) {

		return error.code;

	}

}

function assembler() {

	const kit = KitManifest.load();

	return { kit, kitAssembler: new KitAssembler( atlas, new RequestAssembler( atlas, { apertures: [] } ), kit ) };

}

function build( parcelId ) {

	const { kitAssembler } = assembler();
	const root = mkdtempSync( join( tmpdir(), 'urbe-kit-' ) );
	const record = kitAssembler.build( parcelId, join( root, parcelId ) );

	kitAssembler.plans.publish( root );

	return {
		root,
		record,
		plan: JSON.parse( readFileSync( join( root, planPath( record.plan ) ), 'utf8' ) ),
		read: ( name ) => readFileSync( join( root, parcelId, name ) )
	};

}

describe( 'kit assembly', () => {

	it( 'builds ordinary parcels from the kit and leaves landmarks to the generator', () => {

		const { kitAssembler } = assembler();

		expect( kitAssembler.candidate( 'p0' ) ).toBe( null );
		expect( kitAssembler.candidate( 'p1' ).family ).toEqual( expect.any( String ) );
		expect( failure( () => kitAssembler.build( 'p0', tmpdir() ) ) ).toBe( 'E_KIT_FIT' );

	} );

	it( 'writes a placement record, the plan it names and the building blueprint, all valid', () => {

		const { root, record, plan, read } = build( 'p1' );

		try {

			const document = JSON.parse( read( placementsFile( 'p1' ) ).toString( 'utf8' ) );
			const blueprint = JSON.parse( read( blueprintFile( 'p1' ) ).toString( 'utf8' ) );

			expect( schemaMessage( validateKitPlacements( document ) ) ).toBe( '' );
			expect( schemaMessage( validateKitPlan( plan ) ) ).toBe( '' );
			expect( schemaMessage( validateExteriorBlueprint( blueprint ) ) ).toBe( '' );
			expect( document ).toEqual( JSON.parse( JSON.stringify( record ) ) );
			expect( blueprint.buildingId ).toBe( 'p1' );
			expect( document.signText ).toBe( 'CAFE DEL SUR' );
			expect( plan.id ).toBe( document.plan );
			expect( plan.doors ).toHaveLength( 1 );

		} finally { rmSync( root, { recursive: true, force: true } ); }

	} );

	it( 'reads the lot as bays: an edge of 8N metres places N pieces per face', () => {

		const { root, record, plan } = build( 'p2' );

		try {

			expect( [ plan.baysAcross, plan.baysDeep ].sort() ).toEqual( [ 5, 7 ] );
			expect( plan.placements ).toHaveLength( record.floors * 2 * ( 5 + 7 ) );
			expect( record.bounds.max[ 0 ] - record.bounds.min[ 0 ] ).toBeCloseTo( 40, 6 );
			expect( record.bounds.max[ 2 ] - record.bounds.min[ 2 ] ).toBeCloseTo( 56, 6 );

		} finally { rmSync( root, { recursive: true, force: true } ); }

	} );

	it( 'gives the same parcel the same building, byte for byte', () => {

		const first = build( 'p1' );
		const second = build( 'p1' );

		try {

			expect( second.read( placementsFile( 'p1' ) ).equals( first.read( placementsFile( 'p1' ) ) ) ).toBe( true );
			expect( second.read( blueprintFile( 'p1' ) ).equals( first.read( blueprintFile( 'p1' ) ) ) ).toBe( true );

		} finally {

			rmSync( first.root, { recursive: true, force: true } );
			rmSync( second.root, { recursive: true, force: true } );

		}

	} );

	it( 'takes over a folder a generated shell stood in, leaving its geometry behind', () => {

		const { kitAssembler } = assembler();
		const root = mkdtempSync( join( tmpdir(), 'urbe-kit-over-' ) );
		const parcelDir = join( root, 'p1' );

		try {

			mkdirSync( parcelDir, { recursive: true } );
			writeFileSync( join( parcelDir, 'p1.glb' ), 'stale geometry' );
			writeFileSync( join( parcelDir, 'p1.request.json' ), '{}' );
			kitAssembler.build( 'p1', parcelDir );

			expect( existsSync( join( parcelDir, placementsFile( 'p1' ) ) ) ).toBe( true );
			expect( existsSync( join( parcelDir, 'p1.glb' ) ) ).toBe( false );
			expect( existsSync( join( parcelDir, 'p1.request.json' ) ) ).toBe( false );

		} finally { rmSync( root, { recursive: true, force: true } ); }

	} );

	it( 'refuses a directory that publishes no kit, and finds none there', () => {

		const root = mkdtempSync( join( tmpdir(), 'urbe-kit-none-' ) );

		try {

			expect( failure( () => KitManifest.load( root ) ) ).toBe( 'E_KIT_MANIFEST' );
			expect( KitManifest.find( root ) ).toBe( null );

		} finally { rmSync( root, { recursive: true, force: true } ); }

	} );

} );
