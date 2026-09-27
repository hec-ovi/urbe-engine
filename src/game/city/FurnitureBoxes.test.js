import { expect, it } from 'vitest';
import { furnitureBoxes } from './FurnitureBoxes.js';

it( 'uses catalog dimensions and placement scale, yaw and floor without visiting vertices', () => {

	const props = { has: id => id === 'desk', entries: new Map( [ [ 'desk', { dimensionsMeters: [ 2, 0.8, 1 ] } ] ] ),
		surfacesOf: () => { throw new Error( 'collision must not read furniture vertices' ); } };
	const placement = { prop: 'desk', position: [ 5, 0.2, 6 ], rotationY: Math.PI / 2, scale: [ 2, 3, 4 ] };
	expect( furnitureBoxes( [ placement, { ...placement, prop: 'absent' } ], 10, props ) ).toEqual( [ {
		center: [ 5, 11.7, 6 ], halfExtents: [ 2, 1.5, 1.6 ], rotationY: Math.PI / 2
	} ] );

} );
