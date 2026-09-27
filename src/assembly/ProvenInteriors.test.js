import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PROVEN_DESIGNS, provenParcels, provenStandIns, standingDesign } from './ProvenInteriors.js';

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

	it( 'stands a free proven building of its kind in for a plain story place, its own district first, and keeps a place none can stand in for', () => {

		const atlas = { parcels: [
			{ id: 'p0', type: 'clinic', districtId: 'd0' }, { id: 'p1', type: 'commerce', districtId: 'd0' },
			{ id: 'p2', type: 'commerce', districtId: 'd1' }, { id: 'p3', type: 'commerce', districtId: 'd0' },
			{ id: 'p4', type: 'commerce', districtId: 'd0' }, { id: 'p5', type: 'commerce', districtId: 'd1' },
			{ id: 'p6', type: 'police', districtId: 'd1' }
		] };
		const proven = new Set( [ 'p2', 'p3', 'p4' ] );
		// p1 takes p3, the first proven market of its district; p5 finds its district's p2;
		// p4 is a story place of its own; the city's one clinic and police station stand plain.
		expect( provenStandIns( atlas, [ 'p0', 'p1', 'p5', 'p4', 'p6' ], proven ) ).toEqual( [ 'p0', 'p3', 'p2', 'p4', 'p6' ] );
		// With every proven market taken, a plain one keeps its own place.
		expect( provenStandIns( atlas, [ 'p2', 'p3', 'p4', 'p1' ], proven ) ).toEqual( [ 'p2', 'p3', 'p4', 'p1' ] );

	} );

} );
