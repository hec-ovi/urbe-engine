import { describe, expect, it } from 'vitest';
import { buildingFacts } from './BuildingFacts.js';

const plan = {
	floors: [
		{ index: 0, elevation: 0, lifts: [ { id: 'elev-0' }, { id: 'elev-1' } ], stairs: [ { id: 'stair-a' } ],
			rooms: [ { kind: 'lobby' }, { kind: 'corridor' }, { kind: 'mechanical_room' }, { kind: 'lobby' } ] },
		{ index: 1, elevation: 4.5, lifts: [ { id: 'elev-0' }, { id: 'elev-1' } ], stairs: [ { id: 'stair-a' } ],
			rooms: [ { kind: 'corridor' }, { kind: 'living', unit: 'f1-home-1' }, { kind: 'bedroom', unit: 'f1-home-1' } ] }
	],
	apartments: [ { floor: 1, unit: 'f1-home-2', number: '102' }, { floor: 1, unit: 'f1-home-1', number: '101' } ]
};

describe( 'buildingFacts', () => {

	it( 'says what each floor holds, the lifts and stairs, the room a person is in and who is inside, nearest first', () => {

		expect( buildingFacts( plan, { room: 'lobby', insiders: [
			{ role: 'security', floor: 0, room: 'corridor', metres: 9 },
			{ name: 'Mira Chen', role: 'receptionist', floor: 0, room: 'lobby', metres: 2 }
		] } ) ).toEqual( {
			floors: [ { index: 0, rooms: [ 'lobby', 'mechanical_room' ] }, { index: 1, rooms: [], apartments: [ '101', '102' ] } ],
			lifts: 2, stairs: 1, room: 'lobby',
			people: [ { name: 'Mira Chen', role: 'receptionist', floor: 0, room: 'lobby' }, { role: 'security', floor: 0 } ]
		} );
		expect( buildingFacts( plan ) ).toEqual( {
			floors: [ { index: 0, rooms: [ 'lobby', 'mechanical_room' ] }, { index: 1, rooms: [], apartments: [ '101', '102' ] } ], lifts: 2, stairs: 1
		} );

	} );

} );
