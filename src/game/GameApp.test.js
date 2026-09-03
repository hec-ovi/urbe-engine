import { describe, expect, it } from 'vitest';
import { pickSpawn, savedSpawn } from './GameApp.js';

describe( 'game spawn', () => {

	it( 'uses the authoritative height of the selected walk node', () => {

		const networks = { walk: { nodes: [
			{ id: 'near', x: 0, y: 8, z: 0, kind: 'corner' },
			{ id: 'far', x: 100, y: 8, z: 0, kind: 'corner' }
		] } };
		const atlas = { parcels: [ { access: { point: [ 0, 0 ] } } ] };
		const spawn = pickSpawn( networks, atlas );

		expect( spawn.point.y ).toBeCloseTo( 8.17 );
		expect( spawn.lookAt.y ).toBeCloseTo( 8.12 );

	} );

	it( 'restores the saved foot point and heading without deriving a new spawn', () => {

		const spawn = savedSpawn( { player: { position: { x: 14.5, y: 2.25, z: -8 }, heading: - 1.2 } } );
		expect( spawn.point.toArray() ).toEqual( [ 14.5, 2.25, - 8 ] );
		expect( spawn.heading ).toBe( - 1.2 );

	} );

} );
