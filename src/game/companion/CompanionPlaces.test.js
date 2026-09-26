import { describe, expect, it } from 'vitest';
import { CompanionLines } from './CompanionLines.js';
import { CompanionPlaces } from './CompanionPlaces.js';

const ATLAS = {
	parcels: [
		{ id: 'p1', type: 'coffee_shop' }, { id: 'p2', type: 'restaurant', name: 'Bar Nadir' },
		{ id: 'p3', type: 'residential' }, { id: 'p4', type: 'mall' }, { id: 'p5', type: 'clinic' },
		{ id: 'p6', type: 'police' }, { id: 'p7', type: 'factory' }
	],
	transit: {
		busStops: [ { id: 'b1', position: [ 0, 0 ] } ],
		subwayStations: [ { id: 's1', name: 'Quay Street', position: [ 0, 0 ] } ]
	}
};

describe( 'companion places', () => {

	it( 'names a place by its own name, else by what it is', () => {

		const places = setup();
		expect( [ 'p1', 'p2', 'p9' ].map( ( id ) => places.name( { kind: 'parcel', id } ) ) ).toEqual( [ 'the coffee shop', 'Bar Nadir', null ] );
		expect( [ 'b1', 's1', 'x' ].map( ( id ) => places.name( { kind: 'stop', id } ) ) ).toEqual( [ 'the bus stop', 'Quay Street', null ] );

	} );

	it( 'ranks quest, scene, work, home and haunt, keeps the best reason for one place with what a scene shows there, and offers four within reach', () => {

		const places = setup();
		const npc = {
			job: { parcelId: 'p5' }, transitJob: null, home: { parcelId: 'p3' },
			routine: [
				{ activity: 'leisure', place: { kind: 'parcel', id: 'p4' } },
				{ activity: 'shopping', place: { kind: 'parcel', id: 'p1' } },
				{ activity: 'leisure', place: { kind: 'parcel', id: 'p7' } }
			]
		};
		const found = places.destinations( {
			npc, from: [ 0, 0, 0 ], playerPlaces: [ { kind: 'district', id: 'd1' }, { kind: 'station', id: 's1' } ],
			quests: [
				{ questId: 'q', stepId: 'a', place: { kind: 'parcel', id: 'p5' } },
				{ questId: 'q', stepId: 'b', place: { kind: 'station', id: 's1' } },
				{ questId: 'q', stepId: 'c', place: { kind: 'district', id: 'd1' } }
			],
			scenes: [
				{ place: { kind: 'parcel', id: 'p2' }, name: 'the kitchen', relation: 'scene' },
				{ place: { kind: 'parcel', id: 'p5' }, name: 'the back room', relation: 'scene', notes: [ 'A body lies on the ground.' ] }
			]
		} );
		expect( found.map( ( entry ) => [ entry.place.id, entry.relation, entry.name, entry.distance, entry.notes ] ) ).toEqual( [
			[ 'p5', 'quest', 'the clinic', 500, [ 'A body lies on the ground.' ] ],
			[ 'p2', 'scene', 'the kitchen', 200, undefined ],
			[ 'p3', 'home', 'the apartment block', 300, undefined ],
			[ 'p1', 'haunt', 'the coffee shop', 100, undefined ]
		] );

	} );

	it( 'leaves out what is too near, too far or has no way there', () => {

		const places = setup( ( from, to ) => to[ 0 ] === 400 ? null : { distanceMeters: Math.abs( to[ 0 ] - from[ 0 ] ) } );
		const npc = {
			job: { parcelId: 'p6' }, home: { parcelId: 'p3' },
			routine: [ { activity: 'leisure', place: { kind: 'parcel', id: 'p7' } }, { activity: 'leisure', place: { kind: 'parcel', id: 'p4' } } ]
		};
		const ids = ( from ) => places.destinations( { npc, from, playerPlaces: [] } ).map( ( entry ) => entry.place.id );
		expect( ids( [ 0, 0, 0 ] ) ).toEqual( [ 'p6', 'p3' ] );
		expect( ids( [ 295, 0, 0 ] ) ).toEqual( [ 'p6', 'p7' ] );

	} );

} );

/** Parcel pN stands N * 100 m east of the origin, except p7 at 900 m; every walk is straight unless `route` says otherwise. */
function setup( route = ( from, to ) => ( { distanceMeters: Math.abs( to[ 0 ] - from[ 0 ] ) } ) ) {

	const places = [ 1, 2, 3, 4, 5, 6 ].map( ( n ) => ( { kind: 'parcel', id: `p${n}`, position: [ n * 100, 0, 0 ] } ) );
	places.push( { kind: 'parcel', id: 'p7', position: [ 900, 0, 0 ] }, { kind: 'stop', id: 's1', position: [ 50, 0, 0 ] } );
	return new CompanionPlaces( { atlas: ATLAS, places, routes: { route }, lines: CompanionLines.standard() } );

}
