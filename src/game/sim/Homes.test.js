import { describe, expect, it } from 'vitest';
import { castNames, homesOf } from './Homes.js';

/** Two floors of one layout, two numbered homes each, a corridor with no unit. */
const source = {
	interior: {
		building: {
			floors: [
				{ index: 0, layout: 'ground', elevation: 0, openings: {} },
				{ index: 1, layout: 'middle', elevation: 4.5, openings: {}, apartmentEntrances: [
					{ unit: 'f1-home-1', number: '101', position: [ 475, 680.5 ] }, { unit: 'f1-home-2', number: '102', position: [ 492, 680.5 ] }
				] },
				{ index: 2, layout: 'middle', elevation: 9, openings: {}, apartmentEntrances: [
					{ unit: 'f1-home-1', number: '201', position: [ 475, 680.5 ] }, { unit: 'f1-ghost', number: '299', position: [ 1, 1 ] }
				] }
			]
		},
		layouts: {
			ground: { floor: { rooms: [ { id: 'lobby' } ] } },
			middle: { floor: { rooms: [
				{ id: 'f1-corridor' }, { id: 'f1-r26', unit: 'f1-home-1' }, { id: 'f1-r30', unit: 'f1-home-1' }, { id: 'f1-r31', unit: 'f1-home-2' }
			] } }
		}
	}
};

describe( 'homesOf', () => {

	it( 'makes a dwelling of each numbered entrance with its unit\'s rooms as the anchors name them, per floor', () => {

		expect( homesOf( source ) ).toEqual( [
			{ id: 'floor:1/f1-home-1', floor: 1, number: '101', rooms: [ 'floor:1/f1-r26', 'floor:1/f1-r30' ], entrance: [ 475, 680.5 ] },
			{ id: 'floor:1/f1-home-2', floor: 1, number: '102', rooms: [ 'floor:1/f1-r31' ], entrance: [ 492, 680.5 ] },
			{ id: 'floor:2/f1-home-1', floor: 2, number: '201', rooms: [ 'floor:2/f1-r26', 'floor:2/f1-r30' ], entrance: [ 475, 680.5 ] }
		] );
		expect( homesOf( {} ) ).toEqual( [] );

	} );

	it( 'keeps every family and full name a story gives its roles', () => {

		const questlines = [
			{ roles: [ { characterName: { given: 'Mira', family: 'Chen' } }, { reservedName: { given: 'Petra', family: 'Moss' } }, {} ] },
			{ roles: [ { characterName: { given: 'Mira', family: 'Chen' } }, { characterName: { given: 'Kip', family: 'Moss' } } ] }
		];
		expect( castNames( questlines ) ).toEqual( {
			family: [ 'Chen', 'Moss' ],
			full: [ { given: 'Mira', family: 'Chen' }, { given: 'Petra', family: 'Moss' }, { given: 'Kip', family: 'Moss' } ]
		} );

	} );

} );
