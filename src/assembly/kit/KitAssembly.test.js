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

	return new KitAssembler( atlas, new RequestAssembler( atlas, { apertures: [] } ), kit );

}

/** Builds one parcel into a fresh root, over whatever the caller left standing there. */
function build( parcelId, stale = {} ) {

	const kitAssembler = assembler();
	const root = mkdtempSync( join( tmpdir(), 'urbe-kit-' ) );
	const parcelDir = join( root, parcelId );

	mkdirSync( parcelDir, { recursive: true } );
	for ( const [ name, content ] of Object.entries( stale ) ) writeFileSync( join( parcelDir, name ), content );

	const record = kitAssembler.build( parcelId, parcelDir );

	kitAssembler.plans.publish( root );

	return {
		root,
		record,
		plan: JSON.parse( readFileSync( join( root, planPath( record.plan ) ), 'utf8' ) ),
		read: ( name ) => readFileSync( join( parcelDir, name ) ),
		has: ( name ) => existsSync( join( parcelDir, name ) )
	};

}

describe( 'kit assembly', () => {

	it( 'builds ordinary parcels from the kit, leaves landmarks to the generator and needs a published kit', () => {

		const kitAssembler = assembler();
		const empty = mkdtempSync( join( tmpdir(), 'urbe-kit-none-' ) );

		try {

			expect( kitAssembler.candidate( 'p0' ) ).toBe( null );
			expect( kitAssembler.candidate( 'p1' ).family ).toEqual( expect.any( String ) );
			expect( failure( () => kitAssembler.build( 'p0', tmpdir() ) ) ).toBe( 'E_KIT_FIT' );
			expect( failure( () => KitManifest.load( empty ) ) ).toBe( 'E_KIT_MANIFEST' );
			expect( KitManifest.find( empty ) ).toBe( null );

		} finally { rmSync( empty, { recursive: true, force: true } ); }

	} );

	it( 'writes a valid record, plan and blueprint over any shell that stood there, the same bytes every time', () => {

		const first = build( 'p1', { 'p1.glb': 'stale geometry', 'p1.request.json': '{}' } );
		const second = build( 'p1' );
		const bays = build( 'p2' );

		try {

			const document = JSON.parse( first.read( placementsFile( 'p1' ) ).toString( 'utf8' ) );
			const blueprint = JSON.parse( first.read( blueprintFile( 'p1' ) ).toString( 'utf8' ) );

			expect( schemaMessage( validateKitPlacements( document ) ) ).toBe( '' );
			expect( schemaMessage( validateKitPlan( first.plan ) ) ).toBe( '' );
			expect( schemaMessage( validateExteriorBlueprint( blueprint ) ) ).toBe( '' );
			expect( document ).toEqual( JSON.parse( JSON.stringify( first.record ) ) );
			expect( blueprint.buildingId ).toBe( 'p1' );
			expect( document.signText ).toBe( 'CAFE DEL SUR' );
			expect( first.plan.id ).toBe( document.plan );
			expect( first.plan.doors ).toHaveLength( 1 );

			// the folder holds one building: the geometry of the shell it replaced is gone
			expect( first.has( 'p1.glb' ) ).toBe( false );
			expect( first.has( 'p1.request.json' ) ).toBe( false );

			for ( const name of [ placementsFile( 'p1' ), blueprintFile( 'p1' ) ] ) {

				expect( second.read( name ).equals( first.read( name ) ) ).toBe( true );

			}

			// an edge of 8N metres is N pieces per face, and a storey places them all
			expect( [ bays.plan.baysAcross, bays.plan.baysDeep ].sort() ).toEqual( [ 5, 7 ] );
			expect( bays.plan.placements ).toHaveLength( bays.record.floors * 2 * ( 5 + 7 ) );
			expect( bays.record.bounds.max[ 0 ] - bays.record.bounds.min[ 0 ] ).toBeCloseTo( 40, 6 );
			expect( bays.record.bounds.max[ 2 ] - bays.record.bounds.min[ 2 ] ).toBeCloseTo( 56, 6 );

		} finally {

			for ( const { root } of [ first, second, bays ] ) rmSync( root, { recursive: true, force: true } );

		}

	} );

} );
