import { describe, expect, it } from 'vitest';
import { interiorPlan, parseCityArgs } from './CityPlan.js';

const atlas = {
	meta: { seed: 'city' },
	parcels: [
		{ id: 'p0', type: 'commerce' },
		{ id: 'p1', type: 'hotel' },
		{ id: 'p2', type: 'residential' }
	]
};

describe( 'city batch plan', () => {

	it( 'accepts an existing shell stage and exact manual interiors', () => {

		const args = parseCityArgs( [
			'--blueprint', 'city.json', '--out', 'out/game', '--reuse-shells', 'true',
			'--interior-parcels', 'p1,p0'
		] );

		expect( args ).toMatchObject( { reuseShells: true, interiorParcels: [ 'p1', 'p0' ] } );
		expect( interiorPlan( atlas, [], [ 'p0', 'p1', 'p2' ], args ) ).toEqual( {
			candidates: [ 'p1', 'p0' ], target: 2, unknown: [], unavailable: []
		} );

	} );

	it( 'rejects contradictory, duplicate and non-integral options', () => {

		const base = [ '--blueprint', 'city.json', '--out', 'out/game' ];
		expect( parseCityArgs( [ ...base, '--reuse-shells', 'true', '--parcel', 'p0' ] ) ).toBeNull();
		expect( parseCityArgs( [ ...base, '--interior-parcels', 'p0,p0' ] ) ).toBeNull();
		expect( parseCityArgs( [ ...base, '--workers', '2.5' ] ) ).toBeNull();

	} );

	it( 'fails closed when a manual interior is unknown or lacks a shell', () => {

		const args = { interiors: 5, interiorParcels: [ 'p0', 'p1', 'p9' ] };

		expect( interiorPlan( atlas, [], [ 'p0' ], args ) ).toMatchObject( {
			unknown: [ 'p9' ], unavailable: [ 'p1' ]
		} );

	} );

} );
