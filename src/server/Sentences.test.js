import { describe, expect, it } from 'vitest';
import { Sentences } from './Sentences.js';

function cut( ...pieces ) {

	const sentences = new Sentences();
	return [ ...pieces.flatMap( ( piece ) => sentences.push( piece ) ), ...sentences.end() ];

}

describe( 'Sentences', () => {

	it( 'cuts after closing punctuation and quotes, at line breaks, and keeps numbers and lone ellipses whole', () => {

		expect( cut( 'Ask at the bar. She said "go!" Then... wait?! Pi is 3.14\nDone' ) ).toEqual( [
			'Ask at the bar.', 'She said "go!"', 'Then...', 'wait?!', 'Pi is 3.14', 'Done'
		] );
		expect( cut( '... Well, fine. …' ) ).toEqual( [ '... Well, fine.', '…' ] );
		expect( cut( '' ) ).toEqual( [] );

	} );

	it( 'gives the same sentences for any split of the stream', () => {

		const text = 'Ask at the bar. She said "go!" Then... wait?! Pi is 3.14\n… Done.';
		const whole = cut( text );
		for ( let at = 0; at <= text.length; at ++ ) expect( cut( text.slice( 0, at ), text.slice( at ) ) ).toEqual( whole );
		expect( cut( ...text ) ).toEqual( whole );

	} );

} );
