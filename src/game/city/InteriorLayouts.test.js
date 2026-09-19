import { describe, expect, it } from 'vitest';
import { buildingFloors, floorPlacements } from './InteriorLayouts.js';

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
		expect( floorPlacements( floors[ 0 ] ).map( ( p ) => p.id ) ).toEqual( [ 'g-wall', 'r0' ] );
		expect( floorPlacements( floors[ 1 ] ) ).toBe( floors[ 1 ].placements );
		expect( floors[ 1 ].lights[ 0 ].position[ 1 ] ).toBe( 7.3 );

	} );

} );
