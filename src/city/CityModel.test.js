import { describe, expect, it } from 'vitest';
import { cityModel, parcelOf, viewerUrl } from './CityModel.js';

const atlas = {
	parcels: [ { id: 'p1', type: 'offices', tier: 'mid', name: 'Apex' }, { id: 'p2', type: 'commerce', tier: 'poor' } ],
	volumetric: {
		buildings: [
			{ parcelId: 'p1', footprint: [ [ 0, 0 ], [ 10, 0 ], [ 10, 8 ], [ 0, 8 ] ], height: 20 },
			{ parcelId: 'p2', footprint: [ [ 20, 0 ], [ 30, 0 ], [ 30, 8 ], [ 20, 8 ] ], height: 9 }
		],
		ground: [ { surface: 'roadway', polygon: [ [ 0, 10 ], [ 30, 10 ], [ 30, 14 ], [ 0, 14 ] ] } ]
	}
};

describe( 'cityModel', () => {

	it( 'stacks a built parcel from its published floors and leaves an unbuilt one as its envelope', () => {

		const built = new Map( [ [ 'p1', [ { index: - 1, elevation: - 4, height: 4 }, { index: 0, elevation: 0, height: 5 }, { index: 1, elevation: 5, height: 3.5 } ] ] ] );
		const model = cityModel( atlas, built );

		expect( model.buildings.map( ( b ) => b.parcelId ) ).toEqual( [ 'p1', 'p2' ] );
		expect( model.buildings[ 0 ] ).toMatchObject( { built: true, type: 'offices', tier: 'mid', name: 'Apex' } );
		expect( model.buildings[ 0 ].floors ).toEqual( [ { index: 0, elevation: 0, height: 5 }, { index: 1, elevation: 5, height: 3.5 } ] );
		expect( model.buildings[ 1 ] ).toMatchObject( { built: false, floors: [ { index: 0, elevation: 0, height: 9 } ] } );
		expect( model.ground ).toBe( atlas.volumetric.ground );

	} );

	it( 'names the parcel a picked object belongs to and the page that opens it', () => {

		const root = { name: 'parcel:p2', parent: null };
		const floor = { name: 'floor:1', parent: root };
		expect( parcelOf( floor ) ).toBe( 'p2' );
		expect( parcelOf( { name: 'ground', parent: null } ) ).toBeNull();
		expect( viewerUrl( 'p2', '/out/small' ) ).toBe( '?mode=building&parcel=p2&out=%2Fout%2Fsmall' );

	} );

} );
