import { describe, expect, it } from 'vitest';
import { blockWorld, mapModel } from './MapModel.js';

const atlas = {
	meta: { bounds: { min: [ 0, 0 ], max: [ 100, 100 ] } },
	streets: { edges: [ { path: [ [ 0, 5 ], [ 100, 5 ] ], width: 8 } ] },
	volumetric: {
		buildings: [ { footprint: [ [ 2, 2 ], [ 8, 2 ], [ 8, 8 ] ], height: 12 } ],
		ground: [ { surface: 'block', polygon: [ [ 0, 0 ], [ 10, 0 ], [ 10, 10 ] ] } ]
	},
	transit: {
		busStops: [ { id: 'b0', position: [ 12, 18 ] } ],
		trainStations: [ { id: 'unused', position: [ 50, 50 ], entrances: [], level: 0 } ],
		subwayStations: [ { id: 's0', position: [ 30, 40 ], entrances: [ [ 28, 40 ], [ 32, 40 ] ], level: -12 } ]
	}
};
const networks = {
	transit: { routes: [
		{
			id: 'bus-route', kind: 'bus', shape: [ [ 1, 2, 3 ], [ 4, 5, 6 ] ],
			stops: [ { stopId: 'b0', x: 12, y: 1.5, z: 18 }, { stopId: 'b0', x: 12, y: 1.5, z: 18 } ]
		},
		{
			id: 'subway-route', kind: 'subway', shape: [ [ 20, -12, 40 ], [ 60, -12, 40 ] ],
			stops: [ { stopId: 's0', x: 30, y: -12, z: 40 }, { stopId: 's0', x: 30, y: -12, z: 40 } ]
		}
	] }
};

describe( 'map models', () => {

	it( 'projects active generated transit onto the minimap without adding unused places', () => {

		const model = mapModel( atlas, networks );

		expect( model.transit.routes ).toEqual( [
			{ id: 'bus-route', kind: 'bus', path: [ [ 1, 3 ], [ 4, 6 ] ] },
			{ id: 'subway-route', kind: 'subway', path: [ [ 20, 40 ], [ 60, 40 ] ] }
		] );
		expect( model.transit.places ).toEqual( [
			{ id: 'bus:b0', refId: 'b0', kind: 'bus', point: [ 12, 18 ] },
			{ id: 'subway:s0:0', refId: 's0', kind: 'subway', point: [ 28, 40 ] },
			{ id: 'subway:s0:1', refId: 's0', kind: 'subway', point: [ 32, 40 ] }
		] );

	} );

	it( 'keeps every Connections height on the full map', () => {

		const world = blockWorld( atlas, networks );

		expect( world.transit.routes[ 0 ].path ).toEqual( [ [ 1, 2, 3 ], [ 4, 5, 6 ] ] );
		expect( world.transit.routes[ 1 ].path ).toEqual( [ [ 20, -12, 40 ], [ 60, -12, 40 ] ] );
		expect( world.transit.places[ 0 ].point ).toEqual( [ 12, 1.5, 18 ] );
		expect( world.transit.places[ 1 ].point ).toEqual( [ 28, 0, 40 ] );

	} );

} );
