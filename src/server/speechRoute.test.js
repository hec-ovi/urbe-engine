import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { sha256Hex } from '../game/voice/src/Canonical.js';
import { speechRoute } from './speechRoute.js';
import { SpeechRuntimeHttp } from './SpeechRuntimeHttp.js';

describe( 'local speech HTTP boundary', () => {

	let server = null;
	afterEach( async () => {

		if ( server ) await new Promise( ( resolve ) => server.close( resolve ) );
		server = null;

	} );

	it( 'serves checked capabilities and rejects altered microphone bytes before inference', async () => {

		const runtime = {
			request: vi.fn( async ( operation ) => {

				if ( operation === 'capabilities' ) return capabilities();
				throw new Error( 'inference should not run' );

			} ),
			dispose: vi.fn()
		};
		const origin = await serve( runtime );
		const capabilityResponse = await fetch( `${origin}/api/speech/capabilities` );
		expect( capabilityResponse.status ).toBe( 200 );
		expect( ( await capabilityResponse.json() ).tts.adapterId ).toBe( 'chatterbox-nano-local' );

		const bytes = new Uint8Array( [ 1, 2, 3 ] );
		const request = {
			version: '1', requestId: 'mic-route', mediaType: 'audio/wav', byteSize: 3,
			sha256: await sha256Hex( bytes ), dataBase64: 'AQIE'
		};
		const rejected = await fetch( `${origin}/api/speech/transcribe`, {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( request )
		} );
		expect( rejected.status ).toBe( 503 );
		expect( ( await rejected.json() ).error ).toContain( 'SHA-256' );
		expect( runtime.request ).toHaveBeenCalledOnce();

	} );

	it( 'cancels the isolated remote model worker when its caller aborts', async () => {

		const calls = [];
		const fetchImpl = vi.fn( ( url, init ) => {

			calls.push( { url, init } );
			if ( url.endsWith( '/cancel' ) ) return Promise.resolve( new Response( '{"cancelled":true}' ) );
			return new Promise( ( _resolve, reject ) => init.signal.addEventListener( 'abort', () => {

				const error = new Error( 'aborted' );
				error.name = 'AbortError';
				reject( error );

			}, { once: true } ) );

		} );
		const runtime = new SpeechRuntimeHttp( 'http://speech:8091', fetchImpl );
		const controller = new AbortController();
		const pending = runtime.request( 'synthesize', { request: { requestId: 'wait' } }, controller.signal );
		controller.abort();
		await expect( pending ).rejects.toMatchObject( { name: 'AbortError' } );
		expect( calls.map( ( call ) => call.url ) ).toEqual( [
			'http://speech:8091/synthesize', 'http://speech:8091/cancel'
		] );
		expect( JSON.parse( calls[ 1 ].init.body ) ).toEqual( { requestId: 'wait' } );

	} );

	async function serve( runtime ) {

		let handler;
		speechRoute( runtime ).configureServer( {
			middlewares: { use( _path, callback ) { handler = callback; } }
		} );
		server = createServer( ( request, response ) => handler( request, response, () => {

			response.statusCode = 404;
			response.end();

		} ) );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		return `http://127.0.0.1:${server.address().port}`;

	}

} );

function capabilities() {

	return {
		tts: {
			version: '1', adapterId: 'chatterbox-nano-local', streaming: false, cancellable: true, maxConcurrent: 1,
			languages: [ 'en-US' ], engine: {
				backendId: 'chatterbox-nano', modelRevision: 'nano', modelSha256: '1'.repeat( 64 ),
				runtimeId: 'urbe-local-speech', runtimeRevision: '1', runtimeSha256: '2'.repeat( 64 )
			}, output: { sampleRate: 24000, channels: 1, codec: 'pcm_s16le', codecVersion: 'pcm-s16le-v1' },
			controls: {
				laugh: 'native', chuckle: 'native', cough: 'native', breath: 'unsupported', sigh: 'unsupported',
				whisper: 'unsupported', pause_ms: 'exact-silence', emotion: 'unsupported'
			}
		},
		stt: {
			version: '1', adapterId: 'faster-whisper-local', modelRevision: 'small', modelSha256: '3'.repeat( 64 ),
			runtimeRevision: '1.2.1', mediaTypes: [ 'audio/wav' ], languages: [ 'auto', 'en' ]
		}
	};

}
