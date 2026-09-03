import { describe, expect, it, vi } from 'vitest';
import { ObjectiveGuide } from './ObjectiveGuide.js';
import { ObjectiveRouter } from './ObjectiveRouter.js';

describe( 'ObjectiveGuide', () => {

	it( 'routes an objective immediately, then reroutes changed feet only at the bounded cadence', () => {

		const router = new ObjectiveRouter( network() );
		const route = vi.spyOn( router, 'route' );
		const guide = new ObjectiveGuide( router );
		const destination = { kind: 'parcel', id: 'p9' };

		expect( guide.update( { deltaSeconds: 0, from: [ 0, 0, 0 ], destination } ).changed ).toBe( true );
		expect( route ).toHaveBeenCalledTimes( 1 );
		expect( guide.update( { deltaSeconds: 0.4, from: [ 4, 0, 0 ], destination } ).changed ).toBe( false );
		expect( route ).toHaveBeenCalledTimes( 1 );
		expect( guide.update( { deltaSeconds: 0.36, from: [ 4, 0, 0 ], destination } ).changed ).toBe( true );
		expect( route ).toHaveBeenCalledTimes( 2 );

		// Cadence elapsed, but sub-threshold foot drift keeps the current route.
		expect( guide.update( { deltaSeconds: 1, from: [ 4.5, 0, 0 ], destination } ).changed ).toBe( false );
		expect( route ).toHaveBeenCalledTimes( 2 );

	} );

	it( 'clears on a non-routable objective and routes a changed destination without waiting', () => {

		const router = new ObjectiveRouter( network() );
		const guide = new ObjectiveGuide( router );
		guide.update( { deltaSeconds: 0, from: [ 0, 0, 0 ], destination: { kind: 'parcel', id: 'p9' } } );

		expect( guide.update( { deltaSeconds: 0, from: [ 0, 0, 0 ], destination: null } ) ).toEqual( { changed: true, route: null } );
		expect( guide.update( { deltaSeconds: 0, from: [ 0, 0, 0 ], destination: null } ) ).toEqual( { changed: false, route: null } );

	} );

} );

function network() {

	return {
		nodes: [
			{ id: 'a', x: 0, y: 0, z: 0, kind: 'corner' },
			{ id: 'entry', x: 10, y: 0, z: 0, kind: 'entry', ref: 'p9' }
		],
		edges: [ { id: 'access', from: 'a', to: 'entry', kind: 'access', path3: [ [ 0, 0, 0 ], [ 10, 0, 0 ] ] } ]
	};

}
