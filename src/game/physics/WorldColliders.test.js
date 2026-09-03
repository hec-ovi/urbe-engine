import { describe, expect, it, vi } from 'vitest';
import { WorldColliders } from './WorldColliders.js';

describe( 'city collider installation', () => {

	it( 'cooks every exact geometry in bounded slices and releases staging data', async () => {

		const added = [];
		const physics = { addTrimesh: ( geometry ) => {

			added.push( geometry.id );
			return { triangles: 2 };

		} };
		const geometries = Array.from( { length: 12 }, ( _, id ) => ( { id, dispose: vi.fn() } ) );
		const colliders = new WorldColliders( physics );

		await colliders.addStaticsAsync( geometries, { sliceMs: 0, release: true } );

		expect( added ).toEqual( geometries.map( ( geometry ) => geometry.id ) );
		expect( geometries.every( ( geometry ) => geometry.dispose.mock.calls.length === 1 ) ).toBe( true );
		expect( colliders.triangles ).toBe( 24 );

	} );

} );
