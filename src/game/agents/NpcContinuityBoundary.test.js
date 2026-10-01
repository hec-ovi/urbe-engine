import { describe, expect, it, vi } from 'vitest';
import { NpcContinuityBoundary } from './NpcContinuityBoundary.js';

const update = { timeMin: 600, playerPosition: [ 0, 0, 0 ], maxDistance: 90 };

describe( 'the NPC continuity\'s schema boundary', () => {

	it( 'compiles every schema as it is made, so play never compiles one', () => {

		const boundary = new NpcContinuityBoundary();
		const compile = vi.spyOn( boundary.ajv, 'compile' );
		expect( boundary.validators.size ).toBeGreaterThan( 20 );
		expect( [ ...boundary.validators.values() ].every( ( validate ) => typeof validate === 'function' ) ).toBe( true );
		expect( boundary.input( 'visible-update', update ) ).toBe( update );
		boundary.output( 'actor-states', [] );
		expect( compile ).not.toHaveBeenCalled();

	} );

	it( 'checks every value while the game loads, and in play only when asked', () => {

		const boundary = new NpcContinuityBoundary();
		const wrong = { ...update, maxDistance: 'far' };
		expect( () => boundary.input( 'visible-update', wrong ) ).toThrow( expect.objectContaining( { code: 'E_NPC_INPUT' } ) );

		boundary.play();
		expect( boundary.input( 'visible-update', wrong ) ).toBe( wrong );
		expect( boundary.output( 'actor-states', [ { npcId: 1 } ] ) ).toEqual( [ { npcId: 1 } ] );
		// A schema the continuity does not know is a mistake whether checked or not.
		expect( () => boundary.input( 'nothing-such', update ) ).toThrow( expect.objectContaining( { code: 'E_NPC_INPUT' } ) );

		boundary.play( true );
		expect( () => boundary.input( 'visible-update', wrong ) ).toThrow( expect.objectContaining( { code: 'E_NPC_INPUT' } ) );
		expect( () => boundary.output( 'actor-states', [ { npcId: 1 } ] ) ).toThrow( expect.objectContaining( { code: 'E_NPC_OUTPUT' } ) );

	} );

} );
