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

	it( 'uses the published merged p19 building over the original p20 hotel lot without changing Atlas', () => {

		const source = mergedParcels();
		const original = structuredClone( source );
		const locator = new Locator( source, [], [], { buildingFootprints: [ marketFootprint() ] } );
		// The real p19 counter and player approach lie in the absorbed p20
		// source lot, but in the valid, wider p19 shell and its own interior.
		for ( const [ x, z ] of [ [ 464.14, 39.88 ], [ 462.64, 39.88 ], [ 436, 38.5 ] ] ) {

			expect( locator.location( x, z ) ).toEqual( { id: 'p19', name: 'p19 commerce' } );
			expect( locator.occupiedParcelId( x, z ) ).toBe( 'p19' );
			expect( locator.parcel( x, z ) ).toBe( 'p19 commerce' );
			expect( locator.refs( x, z ) ).toContainEqual( { kind: 'parcel', id: 'p19' } );

		}
		expect( locator.location( 466, 50 ) ).toEqual( { id: 'p20', name: 'p20 hotel' } );
		expect( locator.occupiedParcelId( 466, 50 ) ).toBeNull();
		expect( locator.location( 405, 40 ).id ).toBe( 'p19' );
		expect( locator.occupiedParcelId( 405, 40 ) ).toBeNull();
		expect( source ).toEqual( original );

	} );

	it( 'keeps holes, setbacks and absent building records from expanding the occupied host', () => {

		const occupied = marketFootprint();
		occupied.holes = [ [ [ 440, 45 ], [ 450, 45 ], [ 450, 55 ], [ 440, 55 ] ] ];
		const locator = new Locator( mergedParcels(), [], [], {
			buildingFootprints: [ { ...marketFootprint(), parcelId: 'not-published' }, occupied ]
		} );

		for ( const [ x, z ] of [ [ 445, 50 ], [ 440, 50 ], [ 450, 50 ], [ 436, 35 ], [ 466, 50 ] ] ) {

			expect( locator.location( x, z ).id ).toBe( 'p20' );
			expect( locator.occupiedParcelId( x, z ) ).toBeNull();

		}
		expect( locator.location( 465.5, 50 ).id ).toBe( 'p19' );
		expect( locator.occupiedParcelId( 465.5, 50 ) ).toBe( 'p19' );
		expect( locator.location( 438, 50 ).id ).toBe( 'p19' );
		expect( locator.location( 490, 80 ).id ).toBe( 'd0' );

	} );

	it( 'uses the same authoritative streamed room for HUD, saved location and quest refs', () => {

		const locator = new Locator( atlas );
		expect( locator.parcel( 12, 12, 'p0' ) ).toBe( 'p0 retail' );
		expect( locator.location( 12, 12, 'p0' ) ).toEqual( { id: 'p0', name: 'p0 retail' } );
		expect( locator.refs( 12, 12, 'p0' ) ).toContainEqual( { kind: 'parcel', id: 'p0' } );
		expect( locator.location( 4, 4, 'missing-room' ).id ).toBe( 'p0' );
		expect( locator.location( 12, 12 ).id ).toBe( 'd0' );

	} );

} );

function mergedParcels() {

	return {
		districts: [ { id: 'd0', kind: 'downtown', tier: 'rich', boundary: [ [ 400, 30 ], [ 500, 30 ], [ 500, 90 ], [ 400, 90 ] ] } ],
		// Deliberately put p20 first: source-lot iteration must not take
		// precedence over the standing building's published footprint.
		parcels: [
			{ id: 'p20', type: 'hotel', lot: [ [ 428, 33.7 ], [ 468, 33.7 ], [ 468, 73.7 ], [ 428, 73.7 ] ] },
			{ id: 'p19', type: 'commerce', lot: [ [ 404, 33.7 ], [ 428, 33.7 ], [ 428, 73.7 ], [ 404, 73.7 ] ] }
		]
	};

}

function marketFootprint() {

	return { parcelId: 'p19', outline: [ [ 406.5, 36.7 ], [ 465.5, 36.7 ], [ 465.5, 70.7 ], [ 406.5, 70.7 ] ] };

}
