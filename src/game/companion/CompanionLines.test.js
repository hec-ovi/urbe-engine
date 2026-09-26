import { describe, expect, it } from 'vitest';
import { CompanionLines } from './CompanionLines.js';

describe( 'companion lines', () => {

	it( 'reads every line from its Markdown document and says the same thing for the same seed', () => {

		const lines = CompanionLines.standard();
		expect( lines.say( 'label-follow' ) ).toBe( 'Come with me' );
		expect( lines.say( 'label-lead-haunt', { place: 'the mall' } ) ).toBe( 'Show me the mall' );
		const once = lines.say( 'lead-waiting', {}, 'a175|960' );
		expect( lines.say( 'lead-waiting', {}, 'a175|960' ) ).toBe( once );
		const said = new Set( Array.from( { length: 40 }, ( _, minute ) => lines.say( 'lead-waiting', {}, `a175|${minute}` ) ) );
		expect( said.size ).toBeGreaterThan( 1 );

	} );

	it( 'refuses a document without a key or with an unknown field, and a line without its value', () => {

		expect( code( () => new CompanionLines( '## label-follow\n\n- Come with me\n' ) ) ).toBe( 'E_COMPANION_LINES' );
		const broken = CompanionLines.standard();
		const markdown = [ ...broken.lines ].map( ( [ key, variants ] ) => `## ${key}\n${variants.map( ( line ) => `- ${line}` ).join( '\n' )}` ).join( '\n\n' );
		expect( new CompanionLines( markdown ).say( 'accept-follow', {}, 'x' ) ).toBe( broken.say( 'accept-follow', {}, 'x' ) );
		expect( code( () => new CompanionLines( `${markdown}\n\n## refuse-busy\n- Ask {someone}.\n` ) ) ).toBe( 'E_COMPANION_LINES' );
		expect( code( () => broken.say( 'arrival-quest' ) ) ).toBe( 'E_COMPANION_LINES' );
		expect( code( () => broken.say( 'no-such-line' ) ) ).toBe( 'E_COMPANION_LINES' );

	} );

} );

function code( run ) {

	try { run(); return null; }
	catch ( error ) { return error.code ?? String( error ); }

}
