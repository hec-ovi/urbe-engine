import { describe, expect, it } from 'vitest';
import { Locator } from './Locator.js';

const atlas = {
	districts: [ { id: 'd0', kind: 'mixed_use', tier: 'mid', boundary: [ [ 0, 0 ], [ 20, 0 ], [ 20, 20 ], [ 0, 20 ] ] } ],
	parcels: [ { id: 'p0', type: 'retail', lot: [ [ 2, 2 ], [ 8, 2 ], [ 8, 8 ], [ 2, 8 ] ] } ],
	transit: {
		busStops: [ { id: 'b0', position: [ 10, 10 ] } ],
		trainStations: [ { id: 't0', position: [ 30, 30 ], level: 0, platform: [ [ 25, 25 ], [ 35, 25 ], [ 35, 35 ], [ 25, 35 ] ] } ],
		subwayStations: [ { id: 's0', position: [ 30, 30 ], level: -12, platform: [ [ 25, 25 ], [ 35, 25 ], [ 35, 35 ], [ 25, 35 ] ] } ]
	}
};

describe( 'saved world location', () => {

	it( 'uses a parcel id inside a building, its district in the street, and outskirts beyond the city', () => {

		const locator = new Locator( atlas );
		expect( locator.location( 4, 4 ) ).toEqual( { id: 'p0', name: 'p0 retail' } );
		expect( locator.location( 12, 12 ) ).toEqual( { id: 'd0', name: 'mixed use · mid' } );
		expect( locator.location( 30, 30 ) ).toEqual( { id: 'outskirts', name: 'outskirts' } );

	} );

	it( 'identifies bus stops and station platforms at their published levels', () => {

		const locator = new Locator( atlas );
		expect( locator.transitPlace( 11, 0, 10 ) ).toEqual( { kind: 'bus-stop', id: 'b0' } );
		expect( locator.transitPlace( 27, 0, 30 ) ).toEqual( { kind: 'train-station', id: 't0' } );
		expect( locator.transitPlace( 27, -12, 30 ) ).toEqual( { kind: 'subway-station', id: 's0' } );
		expect( locator.transitPlace( 27, -6, 30 ) ).toBeNull();
		expect( locator.transitPlace( 20, 0, 20 ) ).toBeNull();
		const raised = new Locator( atlas, [ { kind: 'bus', stops: [ { stopId: 'b0', y: 8 } ] } ] );
		expect( raised.transitPlace( 10, 8, 10 ) ).toEqual( { kind: 'bus-stop', id: 'b0' } );
		expect( raised.transitPlace( 10, 0, 10 ) ).toBeNull();

	} );

	it( 'returns exact district and parcel refs, preferring the streamed room parcel at an entry', () => {

		const locator = new Locator( atlas );
		expect( locator.refs( 4, 4 ) ).toEqual( [ { kind: 'district', id: 'd0' }, { kind: 'parcel', id: 'p0' } ] );
		expect( locator.refs( 12, 12, 'p0' ) ).toEqual( [ { kind: 'district', id: 'd0' }, { kind: 'parcel', id: 'p0' } ] );
		expect( locator.refs( 30, 30 ) ).toEqual( [] );

	} );

} );
