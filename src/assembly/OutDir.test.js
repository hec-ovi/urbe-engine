import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OutDir, MANIFEST_FILE, BLUEPRINT_FILE, NPC_TYPES_FILE } from './OutDir.js';
import namedCity from './named-city.fixture.json';

/**
 * The out dir has to end up holding exactly the blueprint it was built from.
 * A folder left over from a parcel the blueprint merged away is a building
 * standing inside another one the moment the game loads it, so the pruning and
 * the manifest are what stop that, and neither may touch anything assembly did
 * not write itself.
 */
describe( 'OutDir', () => {

	const dirs = [];

	afterEach( () => {

		for ( const dir of dirs ) rmSync( dir, { recursive: true, force: true } );
		dirs.length = 0;

	} );

	it( 'keeps a folder for exactly the parcels the blueprint still has, and touches nothing else', () => {

		const dir = worldWith( [ 'p0', 'p1', 'p9' ] );
		const out = new OutDir( dir );

		mkdirSync( join( dir, 'notes' ) );
		writeFileSync( join( dir, 'notes', 'mine.txt' ), 'keep me\n' );

		// p1 kept its id and moved to another lot: what stands there is in the wrong place
		const moved = { id: 'p1', footprint: [ [ 90, 90 ], [ 100, 90 ], [ 100, 100 ] ] };

		expect( out.prune( [ parcel( 'p0' ), moved ] ).sort() ).toEqual( [ 'p1', 'p9' ] );
		expect( existsSync( join( dir, 'p1' ) ) ).toBe( false );
		expect( existsSync( join( dir, 'p9' ) ) ).toBe( false );
		expect( existsSync( join( dir, 'p0' ) ) ).toBe( true );
		expect( existsSync( join( dir, 'notes', 'mine.txt' ) ) ).toBe( true );

		// a closed building keeps its shell, a failed one leaves nothing behind
		out.dropInterior( 'p0' );
		expect( out.shells( [ 'p0' ] ) ).toEqual( [ 'p0' ] );
		expect( out.interiors( [ 'p0' ] ) ).toEqual( [] );
		out.drop( 'p0' );
		expect( out.shells( [ 'p0' ] ) ).toEqual( [] );

	} );

	it( 'lists every shell, only complete interiors and their floors, beside the blueprint it was built from', () => {

		const dir = worldWith( [ 'p0', 'p1', 'p2' ] );

		// p0 is a two-floor building: it publishes ground and crown and no middle
		rmSync( join( dir, 'p0', 'interior', 'layouts', 'middle.json' ) );
		writeFileSync( join( dir, 'p0', 'interior', 'building.json' ), JSON.stringify( {
			version: 1, buildingId: 'p0', modules: 'modules.json', props: 'catalog.json',
			layouts: { ground: 'layouts/ground.json', crown: 'layouts/crown.json' },
			floors: [ { index: 0, layout: 'ground', elevation: 0, openings: {} }, { index: 1, layout: 'crown', elevation: 4, openings: {} } ]
		} ) + '\n' );
		// p1 got as far as its shell and then failed: no interior on disk
		rmSync( join( dir, 'p1', 'interior' ), { recursive: true } );
		// p2 names three layouts and one of them was never written
		rmSync( join( dir, 'p2', 'interior', 'layouts', 'crown.json' ) );

		const out = new OutDir( dir );
		const atlas = { meta: { seed: 'urbe-tiny', version: '0.2.4' }, parcels: [ parcel( 'p0' ), parcel( 'p1' ), parcel( 'p2' ) ] };
		const shells = out.shells( [ 'p0', 'p1', 'p2', 'p3' ] );

		expect( out.writeManifest( atlas, shells, out.interiors( shells ) ) ).toEqual( {
			contractVersion: '1.0.0', seed: 'urbe-tiny', atlasVersion: '0.2.4',
			named: false, namingTheme: null,
			parcels: [ 'p0', 'p1', 'p2' ], interiors: [ 'p0' ], floors: { p0: [ '000', '001' ] }
		} );
		expect( out.floorsOf( 'p0' ) ).toEqual( [ '000', '001' ] );

		// a named world records its theme, and the blueprint travels with the manifest
		const named = new OutDir( worldWith( [ 'p1', 'p2' ] ) );
		const manifest = named.writeManifest( namedCity, [ 'p1', 'p2' ], [ 'p1' ] );

		expect( manifest.named ).toBe( true );
		expect( manifest.namingTheme ).toBe( 'rain-soaked port city' );
		expect( JSON.parse( readFileSync( join( named.dir, MANIFEST_FILE ), 'utf8' ) ).named ).toBe( true );
		expect( JSON.parse( readFileSync( join( named.dir, BLUEPRINT_FILE ), 'utf8' ) ) ).toEqual( namedCity );

		// the typed NPC set beside the blueprint is carried, and nothing is when there is none
		const source = scratch();

		writeFileSync( join( source, 'city.json' ), '{}' );
		writeFileSync( join( source, NPC_TYPES_FILE ), '{"types":[]}' );
		expect( named.carryTypes( join( source, 'city.json' ) ) ).toBe( true );
		expect( existsSync( join( named.dir, NPC_TYPES_FILE ) ) ).toBe( true );
		expect( named.carryTypes( join( scratch(), 'city.json' ) ) ).toBe( false );

	} );

	/** A scratch folder removed after the test. */
	function scratch() {

		const dir = mkdtempSync( join( tmpdir(), 'urbe-out-' ) );

		dirs.push( dir );

		return dir;

	}

	/** An out dir holding a finished build for each id, all on their own lot. */
	function worldWith( ids ) {

		const dir = scratch();

		for ( const id of ids ) {

			mkdirSync( join( dir, id ), { recursive: true } );
			writeFileSync( join( dir, id, `${id}.request.json` ),
				JSON.stringify( { buildingId: id, parcel: { footprint: parcel( id ).footprint } } ) + '\n' );
			writeFileSync( join( dir, id, `${id}.blueprint.json` ), '{}\n' );
			writeFileSync( join( dir, id, `${id}.glb` ), 'glb' );
			writeInterior( join( dir, id, 'interior' ) );

		}

		return dir;

	}

} );

/** A furnished building on disk as interior writes it: three layouts and no geometry. */
function writeInterior( interiorDir ) {

	const layouts = { ground: 'layouts/ground.json', middle: 'layouts/middle.json', crown: 'layouts/crown.json' };

	mkdirSync( join( interiorDir, 'layouts' ), { recursive: true } );
	writeFileSync( join( interiorDir, 'building.json' ), JSON.stringify( {
		version: 1, buildingId: 'p', modules: 'modules.json', props: 'catalog.json', layouts,
		floors: [ 0, 1, 2 ].map( ( index ) => ( { index, layout: 'middle', elevation: index * 4, openings: {} } ) )
	} ) + '\n' );
	for ( const file of Object.values( layouts ) ) writeFileSync( join( interiorDir, file ), '{}\n' );
	writeFileSync( join( interiorDir, 'npc.json' ), '{}\n' );

}

/** The lot a parcel stands on, the same shape assembly writes into its request. */
function parcel( id ) {

	return { id, footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ], [ 0, 10 ] ] };

}
