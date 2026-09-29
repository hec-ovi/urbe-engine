import { afterEach, describe, expect, it, vi } from 'vitest';
import { CarModels } from './CarModels.js';

describe( 'CarModels', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'reads, builds and stands nothing for a run with no room for a car', async () => {

		const fetch = vi.fn( () => Promise.reject( new Error( 'no car model is read' ) ) );
		vi.stubGlobal( 'fetch', fetch );

		const cars = await CarModels.load( 0 );

		expect( cars.count ).toBe( 0 );
		expect( cars.group.children ).toHaveLength( 0 );
		expect( fetch ).not.toHaveBeenCalled();
		cars.commit( [] );

	} );

} );
