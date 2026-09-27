import { describe, expect, it } from 'vitest';
import { RecentEvents } from './RecentEvents.js';

const parcels = [
	{ id: 'bar', access: { point: [ 0, 0 ] } },
	{ id: 'clinic', access: { point: [ 60, 0 ] } },
	{ id: 'far', access: { point: [ 400, 0 ] } }
];
const here = { x: 0, y: 0, z: 2 };

function scene( parcelId, kind, origin, stagedAtMin = 500 ) {

	return { sceneId: `${parcelId}-scene`, place: { parcelId }, frame: { kind, origin }, stagedAtMin, notes: [ 'It looks like a crime scene.', 'A body lies on the ground.' ] };

}

describe( 'RecentEvents', () => {

	it( 'tells a nearby talk who a car hit, by the nearest building, how far and whether they still lie there, for two hours', () => {

		const events = new RecentEvents( parcels );
		events.struck( { personId: 'p1', point: { x: 55, y: 1, z: 4 }, hard: true, atMin: 600 } );
		events.struck( { personId: 'p2', npcId: 'n2', point: { x: 3, y: 1, z: 6 }, atMin: 610 } );
		events.struck( { personId: 'p3', point: { x: 390, y: 1, z: 0 }, atMin: 611 } );
		const down = ( personId ) => personId === 'p1';

		expect( events.around( { position: here, timeMin: 615, down } ) ).toEqual( [
			{ kind: 'struck', atMin: 610, parcelId: 'bar', metres: 5 },
			{ kind: 'struck', atMin: 600, parcelId: 'clinic', metres: 55, hard: true, down: true }
		] );
		// The person the car hit knows it was them.
		expect( events.around( { position: here, timeMin: 615, npcId: 'n2', down } )[ 0 ] ).toEqual( { kind: 'struck', atMin: 610, parcelId: 'bar', metres: 5, self: true } );
		// Far away, or long after, nobody speaks of it.
		expect( events.around( { position: { x: 390, z: 0 }, timeMin: 615 } ).map( ( event ) => event.parcelId ) ).toEqual( [ 'far' ] );
		expect( events.around( { position: here, timeMin: 721 } ) ).toEqual( [ { kind: 'struck', atMin: 610, parcelId: 'bar', metres: 5 } ] );
		expect( events.around( { position: here, timeMin: 731 } ) ).toEqual( [] );

	} );

	it( 'keeps the newest impacts and hands a talk at most eight events, newest first', () => {

		const events = new RecentEvents( parcels );
		for ( let at = 0; at < 40; at ++ ) events.struck( { personId: `p${at}`, point: { x: 1, z: 1 }, atMin: 600 + at } );
		const told = events.around( { position: here, timeMin: 640 } );
		expect( told.map( ( event ) => event.atMin ) ).toEqual( [ 639, 638, 637, 636, 635, 634, 633, 632 ] );

	} );

	it( 'tells a street scene within reach and a scene inside only to a talk in its building, never the place the person led the player to', () => {

		const events = new RecentEvents( parcels );
		const scenes = [ scene( 'bar', 'interior', { x: 4, y: 0, z: -6 }, 450 ), scene( 'clinic', 'street', { x: 60, y: 0, z: 3 }, 500 ), scene( 'far', 'street', { x: 400, y: 0, z: 3 } ) ];
		const notes = scenes[ 0 ].notes;

		expect( events.around( { position: here, timeMin: 600, scenes } ) ).toEqual( [
			{ kind: 'scene', atMin: 500, parcelId: 'clinic', metres: 60, notes }
		] );
		expect( events.around( { position: here, timeMin: 600, scenes, parcelId: 'bar' } ) ).toEqual( [
			{ kind: 'scene', atMin: 500, parcelId: 'clinic', metres: 60, notes },
			{ kind: 'scene', atMin: 450, parcelId: 'bar', metres: 9, notes }
		] );
		expect( events.around( { position: here, timeMin: 600, scenes, parcelId: 'bar', guided: 'clinic' } ).map( ( event ) => event.parcelId ) ).toEqual( [ 'bar' ] );

	} );

} );
