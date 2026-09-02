import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input } from './Input.js';

describe( 'game input', () => {

	afterEach( () => vi.unstubAllGlobals() );

	it( 'exposes held sprint and crouch, and emits jump once per press', () => {

		const { input, fire } = harness();
		input.locked = true;

		fire( 'keydown', { code: 'ShiftLeft', repeat: false } );
		fire( 'keydown', { code: 'KeyC', repeat: false } );
		fire( 'keydown', { code: 'Space', repeat: false } );

		expect( input.running ).toBe( true );
		expect( input.crouching ).toBe( true );
		expect( input.consume( 'Space' ) ).toBe( true );
		expect( input.consume( 'Space' ) ).toBe( false );

	} );

	it( 'clears held and edge-triggered controls when focus is lost', () => {

		const { input, fire } = harness();
		fire( 'keydown', { code: 'KeyC', repeat: false } );
		fire( 'keydown', { code: 'Space', repeat: false } );
		fire( 'blur' );

		expect( input.crouching ).toBe( false );
		expect( input.consume( 'Space' ) ).toBe( false );

	} );

} );

function harness() {

	const listeners = new Map();
	const target = {
		addEventListener: ( type, handler ) => listeners.set( type, handler ),
		removeEventListener: () => {}
	};
	vi.stubGlobal( 'window', target );
	vi.stubGlobal( 'document', { ...target, pointerLockElement: null } );

	return {
		input: new Input( {} ),
		fire: ( type, event = {} ) => listeners.get( type )( event )
	};

}
