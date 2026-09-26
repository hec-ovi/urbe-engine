import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIPort } from './OpenAIPort.js';

afterEach( () => vi.unstubAllGlobals() );

/** An SSE body of chat.completion.chunk events, then [DONE]; `gapMs` spaces them out. */
function sse( chunks, { gapMs = 0, onCancel = null } = {} ) {

	const encoder = new TextEncoder();
	const frames = [ ...chunks.map( ( chunk ) => `data: ${JSON.stringify( chunk )}\n\n` ), 'data: [DONE]\n\n' ];
	return new Response( new ReadableStream( {
		async pull( controller ) {

			if ( gapMs ) await new Promise( ( resolve ) => setTimeout( resolve, gapMs ) );
			const frame = frames.shift();
			if ( frame === undefined ) controller.close();
			else controller.enqueue( encoder.encode( frame ) );

		},
		cancel: () => onCancel?.()
	} ), { headers: { 'Content-Type': 'text/event-stream' } } );

}

const text = ( content ) => ( { choices: [ { index: 0, delta: { content } } ] } );

describe( 'OpenAI-compatible dialogue port', () => {

	it( 'selects the first advertised model when the configured value is empty, and streams every request', async () => {

		const requests = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url, init ) => {

			requests.push( { url, init } );
			if ( url.endsWith( '/models' ) ) return Response.json( { data: [ { id: 'local-model' } ] } );
			return sse( [ text( 'Rea' ), text( 'dy.' ), { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } } ] );

		} ) );
		const port = new OpenAIPort( 'http://models/v1/', { model: '' } );
		expect( await port.complete( { system: 'Role.', prompt: 'Hello.' } ) ).toBe( 'Ready.' );
		expect( requests.map( ( request ) => request.url ) ).toEqual( [ 'http://models/v1/models', 'http://models/v1/chat/completions' ] );
		expect( JSON.parse( requests[ 1 ].init.body ) ).toEqual( {
			model: 'local-model',
			messages: [ { role: 'system', content: 'Role.' }, { role: 'user', content: 'Hello.' } ],
			stream: true,
			stream_options: { include_usage: true }
		} );
		expect( requests[ 1 ].init.headers.Authorization ).toBeUndefined();
		expect( port.usage ).toEqual( { calls: 1, promptTokens: 12, completionTokens: 3 } );

	} );

	it( 'reads its server, model, key and timeout from the environment and sends the key to every endpoint', async () => {

		const requests = [];
		vi.stubGlobal( 'fetch', vi.fn( async ( url, init ) => {

			requests.push( init.headers );
			return url.endsWith( '/models' ) ? Response.json( { data: [ { id: 'm' } ] } ) : sse( [ text( 'Hi.' ) ] );

		} ) );
		const port = OpenAIPort.fromEnv( { LLM_BASE_URL: 'http://hosted/v1', LLM_MODEL: '', LLM_API_KEY: 'sk-test', LLM_TIMEOUT_MS: '9000' } );
		expect( port ).toMatchObject( { baseUrl: 'http://hosted/v1', model: null, timeoutMs: 9000 } );
		await port.complete( { system: 'S', prompt: 'P' } );
		expect( requests.map( ( headers ) => headers.Authorization ) ).toEqual( [ 'Bearer sk-test', 'Bearer sk-test' ] );
		expect( OpenAIPort.fromEnv( {} ) ).toMatchObject( { baseUrl: 'http://localhost:8080/v1', model: null, timeoutMs: 60000 } );

	} );

	it( 'streams tools out and tool-call fragments back', async () => {

		let body = null;
		vi.stubGlobal( 'fetch', vi.fn( async ( _url, init ) => {

			body = JSON.parse( init.body );
			return sse( [ { choices: [ { index: 0, delta: { tool_calls: [ { index: 0, id: 'c1', function: { name: 'follow_player', arguments: '{}' } } ] } } ] } ] );

		} ) );
		const tools = [ { type: 'function', function: { name: 'follow_player', description: 'Follow.', parameters: { type: 'object' } } } ];
		const deltas = [];
		for await ( const delta of new OpenAIPort( 'http://models/v1', { model: 'm' } ).stream( { messages: [], tools } ) ) deltas.push( delta );
		expect( body.tools ).toEqual( tools );
		expect( deltas ).toEqual( [ { tool_calls: [ { index: 0, id: 'c1', function: { name: 'follow_player', arguments: '{}' } } ] } ] );

	} );

	it( 'reports a refused request with its status and what the server said', async () => {

		vi.stubGlobal( 'fetch', vi.fn( async () => new Response( 'context size exceeded', { status: 400 } ) ) );
		await expect( new OpenAIPort( 'http://models/v1', { model: 'm' } ).complete( { system: 'S', prompt: 'P' } ) )
			.rejects.toThrow( 'model server 400 at http://models/v1: context size exceeded' );

	} );

	it( 'fails a server that sends nothing for the timeout, but not a slow steady stream', async () => {

		vi.stubGlobal( 'fetch', vi.fn( ( _url, init ) => new Promise( ( _resolve, reject ) => {

			init.signal.addEventListener( 'abort', () => reject( init.signal.reason ) );

		} ) ) );
		await expect( new OpenAIPort( 'http://models/v1', { model: 'm', timeoutMs: 30 } ).complete( { system: 'S', prompt: 'P' } ) )
			.rejects.toThrow( 'model server at http://models/v1 sent nothing for 30 ms' );

		vi.stubGlobal( 'fetch', vi.fn( async () => sse( [ text( 'a' ), text( 'b' ), text( 'c' ), text( 'd' ), text( 'e' ), text( 'f' ) ], { gapMs: 60 } ) ) );
		expect( await new OpenAIPort( 'http://models/v1', { model: 'm', timeoutMs: 300 } ).complete( { system: 'S', prompt: 'P' } ) ).toBe( 'abcdef' );

	} );

	it( 'ends the request when the caller aborts or stops reading', async () => {

		vi.stubGlobal( 'fetch', vi.fn( ( _url, init ) => new Promise( ( _resolve, reject ) => {

			init.signal.addEventListener( 'abort', () => reject( init.signal.reason ) );

		} ) ) );
		const controller = new AbortController();
		const pending = new OpenAIPort( 'http://models/v1', { model: 'm' } ).stream( { messages: [] }, { signal: controller.signal } ).next();
		controller.abort();
		await expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );

		const cancel = vi.fn();
		vi.stubGlobal( 'fetch', vi.fn( async () => sse( [ text( 'a' ), text( 'b' ), text( 'c' ) ], { onCancel: cancel } ) ) );
		for await ( const delta of new OpenAIPort( 'http://models/v1', { model: 'm' } ).stream( { messages: [] } ) ) {

			expect( delta ).toEqual( { content: 'a' } );
			break;

		}
		expect( cancel ).toHaveBeenCalled();

	} );

} );
