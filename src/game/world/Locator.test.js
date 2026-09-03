import { describe, expect, it } from 'vitest';
import { Locator } from './Locator.js';

const atlas = {
	districts: [ { id: 'd0', kind: 'mixed_use', tier: 'mid', boundary: [ [ 0, 0 ], [ 20, 0 ], [ 20, 20 ], [ 0, 20 ] ] } ],
	parcels: [ { id: 'p0', type: 'retail', lot: [ [ 2, 2 ], [ 8, 2 ], [ 8, 8 ], [ 2, 8 ] ] } ]
};

describe( 'saved world location', () => {

	it( 'uses a parcel id inside a building, its district in the street, and outskirts beyond the city', () => {

		const locator = new Locator( atlas );
		expect( locator.location( 4, 4 ) ).toEqual( { id: 'p0', name: 'p0 retail' } );
		expect( locator.location( 12, 12 ) ).toEqual( { id: 'd0', name: 'mixed use · mid' } );
		expect( locator.location( 30, 30 ) ).toEqual( { id: 'outskirts', name: 'outskirts' } );

	} );

	it( 'returns exact district and parcel refs, preferring the streamed room parcel at an entry', () => {

		const locator = new Locator( atlas );
		expect( locator.refs( 4, 4 ) ).toEqual( [ { kind: 'district', id: 'd0' }, { kind: 'parcel', id: 'p0' } ] );
		expect( locator.refs( 12, 12, 'p0' ) ).toEqual( [ { kind: 'district', id: 'd0' }, { kind: 'parcel', id: 'p0' } ] );
		expect( locator.refs( 30, 30 ) ).toEqual( [] );

	} );

} );
