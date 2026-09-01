import { describe, it, expect } from 'vitest';
import { RequestAssembler } from './RequestAssembler.js';

/** Minimal atlas blueprint slice shaped per ../atlas/CONTRACT.md. */
const atlas = {
	meta: { seed: 'urbe' },
	parcels: [ {
		id: 'p7',
		type: 'offices',
		tier: 'rich',
		footprint: [ [ 0, 0 ], [ 20, 0 ], [ 20, 14 ], [ 0, 14 ] ],
		access: { edgeId: 'e1', point: [ 10, - 2 ] },
		envelope: { minFloors: 4, maxFloors: 12, floorHeight: 4, maxHeight: 48 }
	} ]
};

/** Aperture shaped per ../connections/schemas/aperture.schema.json. */
const bridgeAperture = {
	id: 'l9a',
	buildingId: 'p7',
	floor: 4,
	face: 1,
	kind: 'bridge',
	u: 7,
	base: 16.25,
	width: 4,
	height: 3.2,
	shape: 'rect',
	cut: {
		polygon: [ [ 20, 16.25, 5 ], [ 20, 16.25, 9 ], [ 20, 19.45, 9 ], [ 20, 19.45, 5 ] ],
		axisDir: [ 1, 0, 0 ]
	},
	linkId: 'l9'
};

const connections = { apertures: [ bridgeAperture, { ...bridgeAperture, id: 'x1', buildingId: 'other' } ] };

describe( 'RequestAssembler', () => {

	it( 'same inputs produce an identical request', () => {

		const a = new RequestAssembler( atlas, connections ).assemble( 'p7' );
		const b = new RequestAssembler( atlas, connections ).assemble( 'p7' );

		expect( JSON.stringify( b ) ).toBe( JSON.stringify( a ) );
		expect( a.seed ).toBe( 'urbe:p7' );
		expect( a.building.type ).toBe( 'offices' );
		expect( a.building.tier ).toBe( 'rich' );
		expect( a.building.floors ).toBeGreaterThanOrEqual( 4 );
		expect( a.building.floors ).toBeLessThanOrEqual( 12 );
		expect( a.theme ).toBe( 'cyberpunk' );
		expect( a.options.glb ).toBe( 'merged' );

	} );

	it( 'passes the parcel apertures through verbatim', () => {

		const request = new RequestAssembler( atlas, connections ).assemble( 'p7' );

		expect( request.apertures ).toEqual( [ bridgeAperture ] );
		expect( JSON.stringify( request.apertures[ 0 ] ) ).toBe( JSON.stringify( bridgeAperture ) );

	} );

} );
