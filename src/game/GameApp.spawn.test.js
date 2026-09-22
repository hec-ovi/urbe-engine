import { expect, it } from 'vitest';
import { pickSpawn } from './GameApp.js';

const atlas = { parcels: [
	{ id: 'empty', access: { point: [ 0, 0 ] } },
	{ id: 'open', access: { point: [ 100, 55 ] } }
] };
const networks = { walk: { nodes: [
	{ kind: 'sidewalk', x: 0, y: 0, z: 0 },
	{ kind: 'sidewalk', x: 50, y: 0, z: 25 },
	{ kind: 'corner', x: 110, y: 0, z: 60 }
] } };
const openBuilding = {
	hasInterior: true,
	blueprint: { buildingId: 'open', floors: [ {
		index: 0, elevation: 0, outline: [ [ 100, 50 ], [ 100, 60 ], [ 90, 60 ], [ 90, 50 ] ],
		openings: [ { id: 'entry', kind: 'door', doorRole: 'main', edge: 0, offset: 4, width: 2, height: 3, sill: 0 } ]
	} ] }
};

it( 'starts partial worlds on the approach sidewalk facing a real rotated entrance', () => {
	const buildings = new Map( [ [ 'open', openBuilding ], [ 'closed', { hasInterior: false } ] ] );
	const spawn = pickSpawn( networks, atlas, buildings );
	expect( spawn.point.toArray() ).toEqual( [ 110, 0.2, 60 ] );
	expect( spawn.lookAt.toArray() ).toEqual( [ 100, 0, 55 ] );
	const noApproach = pickSpawn( { walk: { nodes: [ { kind: 'sidewalk', x: 95, y: 0, z: 55 } ] } }, atlas, buildings );
	expect( noApproach.point.toArray() ).toEqual( [ 107.4, 0.2, 55 ] );
} );

it( 'retains the existing sidewalk fallback when no open building is published', () => {
	const original = pickSpawn( networks, atlas );
	for ( const buildings of [ new Map(), new Map( [ [ 'closed', { hasInterior: false } ] ] ) ] ) {
		const fallback = pickSpawn( networks, atlas, buildings );
		expect( fallback.point.toArray() ).toEqual( original.point.toArray() );
		expect( fallback.lookAt.toArray() ).toEqual( original.lookAt.toArray() );
	}
	expect( original.point.toArray() ).toEqual( [ 50, 0.2, 25 ] );
} );
