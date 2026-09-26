import { describe, expect, it } from 'vitest';
import { Physics } from './Physics.js';

describe( 'Physics', () => {

	it( 'answers queries on what it admitted only after a step, which refresh runs at once', async () => {

		const physics = await Physics.create();
		physics.addBoxes( [ { center: [ 0, - 0.5, 0 ], halfExtents: [ 5, 0.5, 5 ], rotationY: 0 } ] );
		const down = () => physics.world.castRay( new physics.rapier.Ray( { x: 0, y: 2, z: 0 }, { x: 0, y: - 1, z: 0 } ), 5, true );
		expect( down() ).toBeNull();
		expect( physics.step( 0 ) ).toBe( 0 );
		expect( down() ).toBeNull();
		physics.refresh();
		expect( down()?.timeOfImpact ).toBeCloseTo( 2 );

	} );

} );
