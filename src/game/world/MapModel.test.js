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

	it( 'gives the full map each named street\'s lines and each district\'s name over its centre', () => {

		const grid = {
			...atlas,
			streets: { edges: [
				{ id: 'e1', class: 'local', path: [ [ 0, 5 ], [ 50, 5 ] ] },
				{ id: 'e2', class: 'local', path: [ [ 50, 5 ], [ 100, 5 ] ] },
				{ id: 'e3', class: 'local', path: [ [ 20, 0 ], [ 20, 100 ] ] },
				{ id: 'e4', class: 'alley', path: [ [ 0, 60 ], [ 10, 60 ] ] }
			] },
			districts: [
				{ id: 'd0', kind: 'downtown', tier: 'high_rich', center: [ 40, 40 ], boundary: [ [ 0, 0 ], [ 80, 0 ], [ 80, 80 ] ] },
				{ id: 'd1', kind: 'industrial', tier: 'poor', boundary: [ [ 80, 80 ], [ 100, 80 ], [ 100, 100 ], [ 80, 100 ] ] }
			]
		};
		const named = {
			e1: { id: 'street:1', name: 'First Street', kind: 'street' }, e2: { id: 'street:1', name: 'First Street', kind: 'street' },
			e3: { id: 'avenue:1', name: 'First Avenue', kind: 'avenue' }, e4: { id: 'alley:e4', name: 'an alley', kind: 'alley' }
		};
		const world = blockWorld( grid, networks, { streetOf: ( id ) => named[ id ] } );
		expect( world.streets ).toEqual( [
			{ name: 'First Street', paths: [ [ [ 0, 5 ], [ 50, 5 ] ], [ [ 50, 5 ], [ 100, 5 ] ] ] },
			{ name: 'First Avenue', paths: [ [ [ 20, 0 ], [ 20, 100 ] ] ] }
		] );
		expect( world.districts ).toEqual( [
			{ name: 'downtown · high rich', center: [ 40, 40 ] },
			{ name: 'industrial · poor', center: [ 90, 90 ] }
		] );
		// Without names nothing is written on the streets.
		expect( blockWorld( grid, networks ).streets ).toEqual( [] );

	} );

} );
