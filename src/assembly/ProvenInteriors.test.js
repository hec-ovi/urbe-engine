import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PROVEN_DESIGNS, provenParcels, standingDesign } from './ProvenInteriors.js';

const dir = await mkdtemp( join( tmpdir(), 'urbe-proven-' ) );
afterAll( () => rm( dir, { recursive: true, force: true } ) );

async function stand( id, file, value ) {

	await mkdir( join( dir, id ), { recursive: true } );
	await writeFile( join( dir, id, `${id}.${file}.json` ), JSON.stringify( value ) );

}

describe( 'proven interiors', () => {

	it( 'trusts the seven reviewed families, each for a stated reason', () => {

		expect( [ ...PROVEN_DESIGNS.keys() ].sort() ).toEqual( [
			'balcony-grid', 'corporate-sectors', 'faceted-bays', 'garden-taper', 'mirror-frame', 'mirror-shutters', 'white-grid'
		] );
		for ( const reason of PROVEN_DESIGNS.values() ) expect( reason.length ).toBeGreaterThan( 20 );

	} );

	it( 'reads a kit building by its family, a generated shell by its architecture, and passes over the plain building and an empty lot', async () => {

		await stand( 'p1', 'placements', { parcel: 'p1', plan: 'white-grid-commercial-rich-7x5x21f', family: 'white-grid' } );
		await stand( 'p93', 'placements', { parcel: 'p93', plan: 'plain-commercial-mid-3x4x2f', family: null } );
		await stand( 'p0', 'blueprint', { buildingId: 'p0', assembly: { architecture: 'garden-taper' } } );
		await stand( 'p27', 'blueprint', { buildingId: 'p27', architectureSelection: { selected: 'ordinary' } } );
		await stand( 'p67', 'blueprint', { buildingId: 'p67', assembly: { architecture: 'service-storage' } } );

		expect( await standingDesign( dir, 'p1' ) ).toBe( 'white-grid' );
		expect( await standingDesign( dir, 'p93' ) ).toBeNull();
		expect( await standingDesign( dir, 'p0' ) ).toBe( 'garden-taper' );
		expect( await standingDesign( dir, 'p27' ) ).toBeNull();
		expect( await standingDesign( dir, 'p5' ) ).toBeNull();
		expect( [ ...await provenParcels( dir, [ 'p93', 'p1', 'p67', 'p0', 'p27', 'p5' ] ) ] ).toEqual( [ 'p1', 'p0' ] );

	} );

} );
