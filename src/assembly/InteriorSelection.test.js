import { describe, expect, it } from 'vitest';
import { interiorCandidates, questParcelIds, selectInteriors } from './InteriorSelection.js';

const parcels = [
	{ id: 'p0', type: 'residential' },
	{ id: 'p1', type: 'commerce' },
	{ id: 'p2', type: 'hotel' },
	{ id: 'p3', type: 'offices' },
	{ id: 'p4', type: 'clinic' },
	{ id: 'p5', type: 'restaurant' },
	{ id: 'p6', type: 'coffee_shop' },
	{ id: 'p7', type: 'mall' }
];

describe( 'selective interiors', () => {

	it( 'selects a stable set of quest-capable venues independent of parcel order', () => {

		const atlas = { meta: { seed: 'city' }, parcels };
		const reversed = { ...atlas, parcels: [ ...parcels ].reverse() };
		const selected = selectInteriors( atlas, [], 5 );

		expect( selected ).toHaveLength( 5 );
		expect( selectInteriors( reversed, [], 5 ) ).toEqual( selected );
		expect( selected.every( ( id ) => ! [ 'p0', 'p3' ].includes( id ) ) ).toBe( true );
		expect( selected ).not.toEqual( [ 'p1', 'p2', 'p4', 'p5', 'p6' ] );

	} );

	it( 'prioritizes explicit quest places and items, even outside venue types', () => {

		const atlas = { meta: { seed: 'city' }, parcels };
		const quests = [ {
			items: [ { itemId: 'key', atParcelId: 'p0' } ],
			steps: [
				{ target: { kind: 'goto', place: { parcelId: 'p3' } } },
				{ target: { kind: 'work', atParcelId: 'p2' } }
			]
		} ];
		const candidates = interiorCandidates( atlas, quests );

		expect( new Set( candidates.slice( 0, 3 ) ) ).toEqual( new Set( [ 'p0', 'p2', 'p3' ] ) );
		expect( questParcelIds( quests ).sort() ).toEqual( [ 'p0', 'p2', 'p3' ] );

	} );

	it( 'never selects a parcel whose shell is unavailable', () => {

		const atlas = { meta: { seed: 'city' }, parcels };

		expect( selectInteriors( atlas, [], 5, [ 'p2', 'p4' ] ).sort() ).toEqual( [ 'p2', 'p4' ] );

	} );

} );
