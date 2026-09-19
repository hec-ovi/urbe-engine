import { describe, expect, it } from 'vitest';
import { buildingFloors } from './InteriorLayouts.js';

const layout = ( id ) => ( {
	floor: { height: 4.5, rooms: [], core: null, lights: [ { position: [ 1, 2.8, 1 ] } ] },
	placements: [ { id: `${id}-wall`, module: 'wall' } ]
} );

describe( 'a furnished building draws its floors from the layouts it publishes', () => {

	it( 'opens a two-floor building with ground and crown, each floor drawing its own window returns with its layout', () => {

		const floors = buildingFloors( 'p1', {
			building: { floors: [
				{ index: 0, layout: 'ground', elevation: 0, treatments: [ { id: 'r0', module: 'return' } ] },
				{ index: 1, layout: 'crown', elevation: 4.5 }
			] },
			layouts: { ground: layout( 'g' ), crown: layout( 'c' ) }
		} );

		expect( floors.map( ( floor ) => floor.layout ) ).toEqual( [ 'ground', 'crown' ] );
		expect( floors[ 0 ].placements.map( ( p ) => p.id ) ).toEqual( [ 'g-wall', 'r0' ] );
		expect( floors[ 1 ].placements.map( ( p ) => p.id ) ).toEqual( [ 'c-wall' ] );
		expect( floors[ 1 ].lights[ 0 ].position[ 1 ] ).toBe( 7.3 );

	} );

} );
