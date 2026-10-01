import { describe, expect, it } from 'vitest';
import { placedProps } from './InteriorProps.js';

const furnished = ( placements, treatments = [] ) => ( {
	interior: {
		building: { floors: [ { index: 0, layout: 'ground', elevation: 0, treatments }, { index: 1, layout: 'middle', elevation: 4 } ] },
		layouts: {
			ground: { floor: { height: 3, rooms: [], lights: [] }, placements },
			middle: { floor: { height: 3, rooms: [], lights: [] }, placements: [ { prop: 'plant' } ] }
		}
	}
} );

describe( 'InteriorProps', () => {

	it( 'names every furniture model the furnished floors place, once, and nothing of a building whose floors cannot be read', () => {

		const buildings = new Map( [
			[ 'p1', furnished( [ { module: 'wall-a' }, { prop: 'desk' }, { prop: 'chair' }, { prop: 'desk' } ] ) ],
			[ 'p2', { ...furnished( [ { prop: 'sofa' } ] ), hasInterior: false } ],
			[ 'p3', { blueprint: {} } ],
			[ 'p4', { interior: { building: { floors: [] }, layouts: {} } } ],
			[ 'p5', furnished( [ { prop: 'shelf' } ] ) ]
		] );

		expect( [ ...placedProps( buildings ) ].sort() ).toEqual( [ 'chair', 'desk', 'plant', 'shelf' ] );

	} );

} );
