// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubtitleReveal } from './SubtitleReveal.js';

let frame, next, now;
beforeEach( () => {
	now = 0; next = 0; frame = new Map();
	vi.spyOn( performance, 'now' ).mockImplementation( () => now );
	vi.stubGlobal( 'requestAnimationFrame', callback => { frame.set( ++ next, callback ); return next; } );
	vi.stubGlobal( 'cancelAnimationFrame', id => frame.delete( id ) );
} );
afterEach( () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); } );
function tick( time ) { now = time; const pending = [ ...frame.values() ]; frame.clear(); for ( const callback of pending ) callback( time ); }
function fixture() {
	const owner = document.createElement( 'p' ), node = document.createTextNode( '' );
	owner.append( node ); document.body.append( owner );
	return { owner, node, reveal: new SubtitleReveal( { node, owner, charactersPerSecond: 10 } ) };
}
describe( 'SubtitleReveal', () => {
	it( 'reveals whole unicode characters at the configured pace and completes without idle work', () => {
		const { reveal, node } = fixture();
		reveal.set( 'A🌒 night.', { animate: true } );
		expect( node.data ).toBe( '' );
		tick( 200 ); expect( node.data ).toBe( 'A🌒' );
		tick( 1000 ); expect( node.data ).toBe( 'A🌒 night.' );
		expect( frame.size ).toBe( 0 );
	} );
	it( 'can be skipped, replaced, hidden or detached without an old line resurfacing', () => {
		const { reveal, node, owner } = fixture();
		reveal.set( 'Old words', { animate: true } );
		tick( 100 );
		reveal.set( 'New words', { animate: true } );
		reveal.finish(); tick( 200 );
		expect( node.data ).toBe( 'New words' );
		expect( frame.size ).toBe( 0 );
		reveal.set( 'Hide me', { animate: true } ); owner.hidden = true; tick( 250 );
		expect( frame.size ).toBe( 0 );
		owner.hidden = false; reveal.set( 'Detached', { animate: true } ); owner.remove(); tick( 300 );
		expect( frame.size ).toBe( 0 );
	} );
	it( 'follows supplied voice progress monotonically, holds through a pause and honors a skip', () => {
		const { reveal, node } = fixture(); let progress = 0;
		reveal.set( 'abcdefghij', { animate: true } ); reveal.sync( () => progress );
		progress = .3; tick( 100 ); expect( node.data ).toBe( 'abc' );
		tick( 5000 ); expect( node.data ).toBe( 'abc' );
		progress = .2; tick( 5100 ); expect( node.data ).toBe( 'abc' );
		progress = .8; tick( 5200 ); expect( node.data ).toBe( 'abcdefgh' );
		reveal.finish(); progress = .9; tick( 5300 );
		expect( node.data ).toBe( 'abcdefghij' ); expect( frame.size ).toBe( 0 );
	} );
	it( 'shows complete text under reduced motion and leaves streamed updates immediate', () => {
		vi.stubGlobal( 'matchMedia', () => ( { matches: true } ) );
		const { reveal, node } = fixture();
		reveal.set( 'Whole story line', { animate: true } ); expect( node.data ).toBe( 'Whole story line' );
		reveal.set( 'A streamed' ); expect( node.data ).toBe( 'A streamed' );
		reveal.set( 'A streamed reply' ); expect( node.data ).toBe( 'A streamed reply' );
		expect( frame.size ).toBe( 0 );
	} );
} );
