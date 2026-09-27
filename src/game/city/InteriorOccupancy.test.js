import { expect, it } from 'vitest';
import { Vector3 } from 'three/webgpu';
import { interiorOccupancy } from './InteriorOccupancy.js';

it( 'fits lobby bodies inside the room instead of scattering them through the facade', () => {
	const room = { polygon: [ [ 0, 0 ], [ 4, 0 ], [ 4, 6 ], [ 0, 6 ] ], holes: [] };
	const layout = { floor: { rooms: [ room ] }, placements: [ { module: 'fit-desk', position: [ 2, 0, 2 ] } ] };
	const interior = { building: { floors: [ { index: 0, layout: 'ground', elevation: 0 } ] }, layouts: { ground: layout } };
	const { contains, lobby } = interiorOccupancy( interior, new Vector3( 2, 0, 0.5 ) );
	expect( lobby.length ).toBeGreaterThan( 0 );
	for ( const point of lobby ) {
		expect( contains( point ) ).toBe( true );
		expect( point.x ).toBeGreaterThanOrEqual( 0.4 - 1e-9 );
		expect( point.z ).toBeGreaterThanOrEqual( 0.4 - 1e-9 );
		expect( Math.hypot( point.x - 2, point.z - 2 ) ).toBeGreaterThanOrEqual( 1.1 );
	}
} );
