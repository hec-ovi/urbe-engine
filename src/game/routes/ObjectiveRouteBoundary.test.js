import { describe, expect, it, vi } from 'vitest';
import { ObjectiveRouteBoundary } from './ObjectiveRouteBoundary.js';

const update = { deltaSeconds: 0.016, from: [ 0, 0, 0 ], destination: null };

describe( 'the objective routes\' schema boundary', () => {

	it( 'compiles every schema as it is made, and checks in play only when asked', () => {

		const boundary = new ObjectiveRouteBoundary();
		const compile = vi.spyOn( boundary.ajv, 'compile' );
		expect( [ ...boundary.validators.keys() ].sort() ).toEqual( [ 'guide-result', 'guide-update', 'route-places', 'route-request', 'route-result', 'walk-network' ] );
		expect( boundary.input( 'guide-update', update ) ).toBe( update );
		const wrong = { ...update, deltaSeconds: 'soon' };
		expect( () => boundary.input( 'guide-update', wrong ) ).toThrow( expect.objectContaining( { code: 'E_OBJECTIVE_ROUTE_INPUT' } ) );

		boundary.play();
		expect( boundary.input( 'guide-update', wrong ) ).toBe( wrong );
		expect( () => boundary.output( 'nothing-such', {} ) ).toThrow( expect.objectContaining( { code: 'E_OBJECTIVE_ROUTE_OUTPUT' } ) );

		boundary.play( true );
		expect( () => boundary.input( 'guide-update', wrong ) ).toThrow( expect.objectContaining( { code: 'E_OBJECTIVE_ROUTE_INPUT' } ) );
		expect( compile ).not.toHaveBeenCalled();

	} );

} );
