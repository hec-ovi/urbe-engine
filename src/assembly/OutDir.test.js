import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutDir, MANIFEST_FILE, BLUEPRINT_FILE, NPC_TYPES_FILE } from './OutDir.js';
import { writeInteriorFiles } from './BuildingPipeline.js';
import namedCity from './named-city.fixture.json';

/**
 * The out dir has to end up holding exactly the blueprint it was built from.
 * A folder left over from a parcel the blueprint merged away is a building
 * standing inside another one the moment the game loads it, so the pruning and
 * the manifest are what stop that, and neither may touch anything assembly did
 * not write itself.
 */
describe( 'OutDir', () => {

	let dir = null;

	afterEach( () => {

		if ( dir ) rmSync( dir, { recursive: true, force: true } );
		dir = null;

	} );

	it( 'drops the parcels the blueprint no longer has and keeps the rest', () => {

		dir = worldWith( [ 'p0', 'p1', 'p9' ] );
		const out = new OutDir( dir );

		expect( out.prune( [ parcel( 'p0' ), parcel( 'p1' ) ] ) ).toEqual( [ 'p9' ] );
		expect( existsSync( join( dir, 'p9' ) ) ).toBe( false );
		expect( existsSync( join( dir, 'p0' ) ) ).toBe( true );
		expect( existsSync( join( dir, 'p1' ) ) ).toBe( true );

	} );

	it( 'drops a parcel that kept its id but moved to another lot', () => {

		dir = worldWith( [ 'p0', 'p1' ] );

		// the blueprint merged two lots: p1 is still called p1 and stands
		// somewhere else now, so what is on disk is a building in the wrong place
		const moved = { id: 'p1', footprint: [ [ 90, 90 ], [ 100, 90 ], [ 100, 100 ] ] };

		expect( new OutDir( dir ).prune( [ parcel( 'p0' ), moved ] ) ).toEqual( [ 'p1' ] );
		expect( existsSync( join( dir, 'p1' ) ) ).toBe( false );
		expect( existsSync( join( dir, 'p0' ) ) ).toBe( true );

	} );

	it( 'never removes a folder assembly did not write', () => {

		dir = worldWith( [ 'p0' ] );
		mkdirSync( join( dir, 'notes' ) );
		writeFileSync( join( dir, 'notes', 'mine.txt' ), 'keep me\n' );

		expect( new OutDir( dir ).prune( [ parcel( 'p0' ) ] ) ).toEqual( [] );
		expect( existsSync( join( dir, 'notes', 'mine.txt' ) ) ).toBe( true );

	} );

	it( 'leaves nothing behind for a parcel whose build failed', () => {

		dir = worldWith( [ 'p0', 'p1' ] );
		const out = new OutDir( dir );

		out.drop( 'p1' );

		expect( existsSync( join( dir, 'p1' ) ) ).toBe( false );
		expect( out.shells( [ 'p0', 'p1' ] ) ).toEqual( [ 'p0' ] );

	} );

	it( 'lists every shell and only complete interiors with their floor files', () => {

		dir = worldWith( [ 'p0', 'p1', 'p2' ] );
		// p1 got as far as its shell and then failed: no interior on disk
		rmSync( join( dir, 'p1', 'interior' ), { recursive: true } );
		// p2 has a floor document with no GLB beside it: the game could not stream it
		rmSync( join( dir, 'p2', 'interior', 'floors', '000.glb' ) );

		const out = new OutDir( dir );
		const atlas = { meta: { seed: 'urbe-tiny', version: '0.2.4' }, parcels: [ parcel( 'p0' ), parcel( 'p1' ), parcel( 'p2' ) ] };
		const shells = out.shells( [ 'p0', 'p1', 'p2', 'p3' ] );
		const interiors = out.interiors( shells );
		const manifest = out.writeManifest( atlas, shells, interiors );

		expect( manifest ).toEqual( {
			contractVersion: '1.0.0', seed: 'urbe-tiny', atlasVersion: '0.2.4',
			named: false, namingTheme: null,
			parcels: [ 'p0', 'p1', 'p2' ], interiors: [ 'p0' ], floors: { p0: [ '-001', '000' ] }
		} );
		expect( existsSync( join( dir, MANIFEST_FILE ) ) ).toBe( true );

	} );

	it( 'copies the blueprint it was built from beside the manifest', () => {

		dir = worldWith( [ 'p0' ] );
		new OutDir( dir ).writeManifest( namedCity, [ 'p0' ], [ 'p0' ] );

		expect( JSON.parse( readFileSync( join( dir, BLUEPRINT_FILE ), 'utf8' ) ) ).toEqual( namedCity );

	} );

	it( 'carries the typed NPC set that sits beside the blueprint', () => {

		dir = worldWith( [ 'p0' ] );
		const source = mkdtempSync( join( tmpdir(), 'named-' ) );
		writeFileSync( join( source, 'city.json' ), '{}' );
		writeFileSync( join( source, NPC_TYPES_FILE ), '{"types":[]}' );

		const out = new OutDir( dir );

		expect( out.carryTypes( join( source, 'city.json' ) ) ).toBe( true );
		expect( existsSync( join( dir, NPC_TYPES_FILE ) ) ).toBe( true );
		rmSync( source, { recursive: true, force: true } );
		// A blueprint with nothing beside it carries nothing.
		const bare = mkdtempSync( join( tmpdir(), 'bare-' ) );
		expect( new OutDir( dir ).carryTypes( join( bare, 'city.json' ) ) ).toBe( false );
		rmSync( bare, { recursive: true, force: true } );

	} );

	it( 'records a named world with its naming theme', () => {

		dir = worldWith( [ 'p1', 'p2' ] );
		const out = new OutDir( dir );

		const shells = out.shells( [ 'p1', 'p2' ] );
		const manifest = out.writeManifest( namedCity, shells, out.interiors( shells ) );

		expect( manifest.named ).toBe( true );
		expect( manifest.namingTheme ).toBe( 'rain-soaked port city' );
		expect( JSON.parse( readFileSync( join( dir, MANIFEST_FILE ), 'utf8' ) ).named ).toBe( true );

	} );

	it( 'can remove an interior while keeping the closed exterior shell', () => {

		dir = worldWith( [ 'p0' ] );
		const out = new OutDir( dir );

		out.dropInterior( 'p0' );

		expect( out.shells( [ 'p0' ] ) ).toEqual( [ 'p0' ] );
		expect( out.interiors( [ 'p0' ] ) ).toEqual( [] );
		expect( existsSync( join( dir, 'p0', 'interior' ) ) ).toBe( false );

	} );

	it( 'writes an interior as the whole building plus one document and one GLB per floor', () => {

		dir = mkdtempSync( join( tmpdir(), 'urbe-out-' ) );
		const interiorDir = join( dir, 'p0', 'interior' );

		writeInteriorFiles( interiorDir, interior() );

		expect( readdirSync( interiorDir ).sort() ).toEqual( [ 'building.glb', 'floors', 'npc.json' ] );
		expect( readdirSync( join( interiorDir, 'floors' ) ).sort() ).toEqual( [ '-001.glb', '-001.json', '000.glb', '000.json' ] );
		expect( readFileSync( join( interiorDir, 'floors', '-001.glb' ) ) ).toEqual( Buffer.from( [ 1 ] ) );
		expect( JSON.parse( readFileSync( join( interiorDir, 'floors', '000.json' ), 'utf8' ) ).floor ).toBe( 0 );
		expect( new OutDir( dir ).floorsOf( 'p0' ) ).toEqual( [ '-001', '000' ] );

	} );

} );

/** An InteriorResult as the interior library returns it, two floors of it. */
function interior() {

	return {
		glb: Buffer.from( [ 0 ] ),
		floorGlbs: new Map( [ [ - 1, Buffer.from( [ 1 ] ) ], [ 0, Buffer.from( [ 2 ] ) ] ] ),
		floors: [ { floor: - 1 }, { floor: 0 } ],
		npc: {}
	};

}

/** The lot a parcel stands on, the same shape assembly writes into its request. */
function parcel( id ) {

	return { id, footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ] };

}

/** An out dir holding a finished build for each id, all on their own lot. */
function worldWith( ids ) {

	const dir = mkdtempSync( join( tmpdir(), 'urbe-out-' ) );

	for ( const id of ids ) {

		mkdirSync( join( dir, id ), { recursive: true } );
		writeFileSync( join( dir, id, `${id}.request.json` ),
			JSON.stringify( { buildingId: id, parcel: { footprint: parcel( id ).footprint } } ) + '\n' );
		writeFileSync( join( dir, id, `${id}.blueprint.json` ), '{}\n' );
		writeFileSync( join( dir, id, `${id}.glb` ), 'glb' );
		writeInteriorFiles( join( dir, id, 'interior' ), interior() );

	}

	return dir;

}
