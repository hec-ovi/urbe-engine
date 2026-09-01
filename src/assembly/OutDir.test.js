import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutDir, MANIFEST_FILE } from './OutDir.js';

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
		expect( out.built( [ 'p0', 'p1' ] ) ).toEqual( [ 'p0' ] );

	} );

	it( 'lists only the parcels whose build finished, and writes them with the blueprint', () => {

		dir = worldWith( [ 'p0', 'p1' ] );
		// p1 got as far as its shell and then failed: no interior on disk
		rmSync( join( dir, 'p1', 'interior' ), { recursive: true } );

		const out = new OutDir( dir );
		const atlas = { meta: { seed: 'urbe-tiny', version: '0.2.4' } };
		const manifest = out.writeManifest( atlas, out.built( [ 'p0', 'p1', 'p2' ] ) );

		expect( manifest ).toEqual( { seed: 'urbe-tiny', atlasVersion: '0.2.4', parcels: [ 'p0' ] } );
		expect( existsSync( join( dir, MANIFEST_FILE ) ) ).toBe( true );

	} );

} );

/** The lot a parcel stands on, the same shape assembly writes into its request. */
function parcel( id ) {

	return { id, footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ] };

}

/** An out dir holding a finished build for each id, all on their own lot. */
function worldWith( ids ) {

	const dir = mkdtempSync( join( tmpdir(), 'urbe-out-' ) );

	for ( const id of ids ) {

		mkdirSync( join( dir, id, 'interior' ), { recursive: true } );
		writeFileSync( join( dir, id, `${id}.request.json` ),
			JSON.stringify( { buildingId: id, parcel: { footprint: parcel( id ).footprint } } ) + '\n' );
		writeFileSync( join( dir, id, `${id}.blueprint.json` ), '{}\n' );
		writeFileSync( join( dir, id, 'interior', 'building.glb' ), '' );
		writeFileSync( join( dir, id, 'interior', 'npc.json' ), '{}\n' );

	}

	return dir;

}
