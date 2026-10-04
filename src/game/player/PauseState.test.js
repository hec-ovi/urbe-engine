import { describe, expect, it } from 'vitest';
import { PauseState } from './PauseState.js';

describe( 'PauseState', () => {

	it( 'starts paused, plays once the pointer is held, and pauses when the player lets it go on the street', () => {

		const state = new PauseState();
		expect( state.paused ).toBe( true );
		expect( state.holds( null ) ).toBe( true );
		state.update( true );
		expect( state.paused ).toBe( false );
		expect( state.holds( null ) ).toBe( false );
		// The player's own loss pauses, and says so for the host to open the settings.
		expect( state.lost( false ) ).toBe( true );
		expect( state.paused ).toBe( true );
		state.held();
		expect( state.paused ).toBe( false );

	} );

	it( 'lets the world play on with the pointer free after a chat the game opened, and pauses on Escape there', () => {

		const state = new PauseState();
		state.held();
		state.release( true );
		state.update( true );
		state.lost( true );
		state.update( false );
		expect( state.paused ).toBe( false );
		expect( state.free( { locked: false, open: true } ) ).toBe( false );
		// The chat closed and the pointer was not taken back: the world plays on, and nothing opens.
		expect( state.lost( false ) ).toBe( false );
		expect( state.paused ).toBe( false );
		expect( state.free( { locked: false, open: false } ) ).toBe( true );
		expect( state.ask( false ) ).toBe( false );
		expect( state.paused ).toBe( true );
		expect( state.released ).toBe( false );
		// Paused or not, a free pointer with nothing open says how to take it back.
		expect( state.free( { locked: false, open: false } ) ).toBe( true );
		expect( state.free( { locked: true, open: false } ) ).toBe( false );

	} );

	it( 'lets the held pointer go when the player asks for the settings, and pauses on its loss', () => {

		const state = new PauseState();
		state.held();
		expect( state.ask( true ) ).toBe( true );
		expect( state.paused ).toBe( false );
		state.lost( false );
		expect( state.paused ).toBe( true );

	} );

	it( 'pauses on a loss with nothing open, never on one the game made, and holds the world while any panel is open', () => {

		const state = new PauseState();
		state.held();
		state.lost( false );
		state.release( false );
		expect( state.holds( 'QUESTS' ) ).toBe( true );
		state.lost( false );
		expect( state.paused ).toBe( true );
		// A panel opened while playing and closed without the pointer back leaves the world playing on.
		state.held();
		state.release( true );
		state.lost( false );
		expect( state.paused ).toBe( false );
		state.held();
		expect( state.holds( 'MAP' ) ).toBe( true );
		expect( state.holds( null ) ).toBe( false );

	} );

} );
