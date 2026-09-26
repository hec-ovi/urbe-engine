import { describe, expect, it } from 'vitest';
import { interiorPlan, parseCityArgs } from './CityPlan.js';

const atlas = {
	meta: { seed: 'plan' },
	parcels: [
		{ id: 'p0', type: 'residential' }, { id: 'p1', type: 'commerce' }, { id: 'p2', type: 'clinic' },
		{ id: 'p3', type: 'offices' }, { id: 'p4', type: 'restaurant' }, { id: 'p5', type: 'residential' }
	]
};
const shells = atlas.parcels.map( ( parcel ) => parcel.id );
const args = ( ...extra ) => parseCityArgs( [ '--blueprint', 'city.json', '--out', 'world', ...extra ] );

describe( 'city interior plan', () => {

	it( 'opens the priority parcels first in their order, then the carried story places, then venues by hash', () => {

		const questlines = [ { steps: [ { target: { parcelId: 'p4' } } ] } ];
		const plain = interiorPlan( atlas, questlines, shells, args( '--interiors', '3' ) ).candidates;
		const ordered = interiorPlan( atlas, questlines, shells, args( '--interiors', '3', '--interior-priority', 'p5,p3' ) );

		expect( plain[ 0 ] ).toBe( 'p4' );
		expect( plain ).not.toContain( 'p0' );
		expect( ordered.candidates.slice( 0, 3 ) ).toEqual( [ 'p5', 'p3', 'p4' ] );
		// Every venue still follows, each once, so a closed building has a next candidate.
		expect( new Set( ordered.candidates ).size ).toBe( ordered.candidates.length );
		expect( ordered.candidates ).toEqual( expect.arrayContaining( [ 'p1', 'p2' ] ) );
		expect( ordered.target ).toBe( 3 );

	} );

	it( 'names a priority parcel the blueprint lacks and refuses a priority beside an exact pick', () => {

		expect( interiorPlan( atlas, [], shells, args( '--interior-priority', 'p9,p1' ) ).unknown ).toEqual( [ 'p9' ] );
		expect( args( '--interior-parcels', 'p1', '--interior-priority', 'p2' ) ).toBeNull();
		expect( args( '--interior-priority', 'p1,p1' ) ).toBeNull();

	} );

} );
