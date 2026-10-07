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

	it( 'tells a talk close by of the newest car that hit someone hard or left them lying there, for half an hour, and not a bump nobody saw', () => {

		const events = new RecentEvents( parcels );
		events.struck( { personId: 'p1', point: { x: 25, y: 1, z: 4 }, hard: true, atMin: 600 } );
		events.struck( { personId: 'p2', npcId: 'n2', point: { x: 3, y: 1, z: 6 }, atMin: 610 } );
		events.struck( { personId: 'p3', point: { x: 390, y: 1, z: 0 }, hard: true, atMin: 611 } );
		const down = ( personId ) => personId === 'p1';

		// The soft bump by the bar is nothing to talk about; the hard hit 25 m off, its person still down, is.
		expect( events.around( { position: here, timeMin: 615, down } ) ).toEqual( [
			{ kind: 'struck', atMin: 600, parcelId: 'bar', metres: 25, hard: true, down: true }
		] );
		// The person the car hit knows it was them.
		expect( events.around( { position: here, timeMin: 615, npcId: 'n2', down } ) ).toEqual( [ { kind: 'struck', atMin: 610, parcelId: 'bar', metres: 5, self: true } ] );
		// Far away, or after half an hour, nobody speaks of it.
		expect( events.around( { position: { x: 390, z: 0 }, timeMin: 615 } ).map( ( event ) => event.parcelId ) ).toEqual( [ 'far' ] );
		expect( events.around( { position: here, timeMin: 631, down } ) ).toEqual( [] );

	} );

	it( 'tells the people who stood near an impact, and the person hit, about it wherever they talk later', () => {

		const events = new RecentEvents( parcels );
		const people = [
			{ npcId: 'leader', position: { x: 50, y: 0, z: 10 }, fallen: false },
			{ npcId: 'far', position: { x: 300, y: 0, z: 0 }, fallen: false },
			{ npcId: 'lying', position: { x: 2, y: 0, z: 0 }, fallen: true },
			{ npcId: null, position: { x: 1, y: 0, z: 0 }, fallen: false }
		];
		events.struck( { personId: 'p1', npcId: 'hit', point: { x: 1, y: 1, z: 0 }, hard: true, atMin: 600, people } );
		const away = { x: 400, y: 0, z: 0 };

		expect( events.around( { position: away, timeMin: 630, npcId: 'leader', down: () => true } ) ).toEqual( [
			{ kind: 'struck', atMin: 600, parcelId: 'bar', metres: 399, hard: true, down: true }
		] );
		expect( events.around( { position: away, timeMin: 630, npcId: 'hit' } ) ).toEqual( [
			{ kind: 'struck', atMin: 600, parcelId: 'bar', metres: 399, hard: true, self: true }
		] );
		// Somebody too far, or lying on the ground, saw nothing; and the news is old after half an hour.
		for ( const npcId of [ 'far', 'lying', null ] ) expect( events.around( { position: away, timeMin: 630, npcId } ) ).toEqual( [] );
		expect( events.around( { position: away, timeMin: 631, npcId: 'leader' } ) ).toEqual( [] );

	} );

	it( 'hands a talk one impact at most, the newest, never a list of them', () => {

		const events = new RecentEvents( parcels );
		for ( let at = 0; at < 40; at ++ ) events.struck( { personId: `p${at}`, point: { x: 1, z: 1 }, hard: true, atMin: 600 + at } );
		expect( events.around( { position: here, timeMin: 640 } ).map( ( event ) => event.atMin ) ).toEqual( [ 639 ] );

	} );

	it( 'tells a street scene within reach and a scene inside only to a talk in its building, never the place the person led the player to', () => {

		const events = new RecentEvents( parcels );
		const scenes = [ scene( 'bar', 'interior', { x: 4, y: 0, z: -6 }, 450 ), scene( 'clinic', 'street', { x: 60, y: 0, z: 3 }, 500 ), scene( 'far', 'street', { x: 400, y: 0, z: 3 } ) ];
		const notes = scenes[ 0 ].notes;

		expect( events.around( { position: here, timeMin: 600, scenes } ) ).toEqual( [
			{ kind: 'scene', atMin: 500, parcelId: 'clinic', metres: 60, notes }
		] );
		// One scene at most, the newest.
		expect( events.around( { position: here, timeMin: 600, scenes, parcelId: 'bar' } ) ).toEqual( [
			{ kind: 'scene', atMin: 500, parcelId: 'clinic', metres: 60, notes }
		] );
		expect( events.around( { position: here, timeMin: 600, scenes, parcelId: 'bar', guided: 'clinic' } ).map( ( event ) => event.parcelId ) ).toEqual( [ 'bar' ] );

	} );

} );
