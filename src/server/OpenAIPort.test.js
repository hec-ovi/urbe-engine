import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIPort } from './OpenAIPort.js';

afterEach( () => vi.unstubAllGlobals() );

describe( 'OpenAI-compatible dialogue port', () => {

	it( 'selects the first advertised model when the configured value is empty', async () => {

		const requests = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url, init = null ) => {

			requests.push( { url, init } );
			if ( url.endsWith( '/models' ) ) return new Response( JSON.stringify( { data: [ { id: 'local-model' } ] } ) );
			return new Response( JSON.stringify( { choices: [ { message: { content: 'Ready.' } } ] } ) );

		} ) );
		const reply = await new OpenAIPort( 'http://models/v1', '' ).complete( { system: 'Role.', prompt: 'Hello.' } );
		expect( reply ).toBe( 'Ready.' );
		expect( requests.map( ( request ) => request.url ) ).toEqual( [
			'http://models/v1/models', 'http://models/v1/chat/completions'
		] );
		expect( JSON.parse( requests[ 1 ].init.body ) ).toEqual( {
			model: 'local-model',
			messages: [ { role: 'system', content: 'Role.' }, { role: 'user', content: 'Hello.' } ]
		} );

	} );

	it( 'tallies the token usage the server reports', async () => {

		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( JSON.stringify( {
			choices: [ { message: { content: 'Ready.' } } ],
			usage: { prompt_tokens: 12, completion_tokens: 3 }
		} ) ) ) );
		const port = new OpenAIPort( 'http://models/v1', 'local-model' );
		await port.complete( { system: 'Role.', prompt: 'Hello.' } );
		expect( port.usage ).toEqual( { calls: 1, promptTokens: 12, completionTokens: 3 } );

	} );

} );
