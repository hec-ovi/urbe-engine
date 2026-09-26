import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { voiceRoute } from './voiceRoute.js';
import { VoicePort } from './VoicePort.js';

const KEY = 'a'.repeat( 40 );
const HEADER = Buffer.alloc( 44, 1 );
const FRAME = Buffer.alloc( 4096, 2 );
const SPEAKER = { id: 'npc.mara', gender: 'female', age: 42, traits: [ 'ambitious', 'dependable' ], category: 'vendor', label: 'Barista' };

describe( 'NPC speech HTTP boundary', () => {

	const servers = [];
	afterEach( async () => {

		vi.restoreAllMocks();
		for ( const server of servers.splice( 0 ) ) {

			server.closeAllConnections();
			await new Promise( ( resolve ) => server.close( resolve ) );

		}

	} );

	it( 'says whether lines can be spoken from the Voice health, off without a base URL and unreachable when it does not answer', async () => {

		const voice = await fakeVoice();
		const capability = async ( baseUrl ) => ( await fetch( `${await serve( new VoicePort( baseUrl ) )}/api/voice` ) ).json();
		expect( await capability( voice.url ) ).toEqual( { enabled: true, status: 'ok' } );
		voice.health = 'loading';
		expect( await capability( voice.url ) ).toEqual( { enabled: false, status: 'loading' } );
		expect( await capability( '' ) ).toEqual( { enabled: false, status: 'off' } );
		expect( await capability( await closedUrl() ) ).toEqual( { enabled: false, status: 'unreachable' } );

	} );

	it( 'streams a rendering line through unbuffered with its headers, and passes a cached one with its length', async () => {

		const voice = await fakeVoice();
		const origin = await serve( new VoicePort( voice.url ) );
		const response = await speak( origin, { text: 'stream', speaker: SPEAKER } );
		expect( response.status ).toBe( 200 );
		expect( response.headers.get( 'content-type' ) ).toBe( 'audio/wav' );
		expect( response.headers.get( 'x-voice-key' ) ).toBe( KEY );
		expect( response.headers.get( 'x-voice-cache' ) ).toBe( 'miss' );
		const reader = response.body.getReader();
		let received = 0;
		while ( received < HEADER.length + FRAME.length ) received += ( await reader.read() ).value.length;
		expect( received ).toBe( HEADER.length + FRAME.length );
		voice.release();
		for ( let read = await reader.read(); ! read.done; read = await reader.read() ) received += read.value.length;
		expect( received ).toBe( HEADER.length + 2 * FRAME.length );
		expect( voice.lines ).toEqual( [ { text: 'stream', speaker: SPEAKER } ] );

		const cached = await speak( origin, { text: 'hit', speaker: { ...SPEAKER, traits: [] } } );
		expect( cached.headers.get( 'content-length' ) ).toBe( String( HEADER.length + FRAME.length ) );
		expect( cached.headers.get( 'x-voice-cache' ) ).toBe( 'hit' );
		expect( ( await cached.arrayBuffer() ).byteLength ).toBe( HEADER.length + FRAME.length );

	} );

	it( 'fails the read of a line that breaks off and logs it, and stops a line the browser leaves, queued or streaming, without a word', async () => {

		const warn = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
		const voice = await fakeVoice();
		const origin = await serve( new VoicePort( voice.url ) );
		const broken = await speak( origin, { text: 'break', speaker: SPEAKER } );
		expect( broken.status ).toBe( 200 );
		await expect( broken.arrayBuffer() ).rejects.toThrow();
		await vi.waitFor( () => expect( warn ).toHaveBeenCalledExactlyOnceWith( 'voice: a line broke off:', expect.any( String ) ) );

		const queuedLeft = new AbortController();
		const queued = speak( origin, { text: 'queue', speaker: SPEAKER }, queuedLeft.signal );
		await voice.waiting;
		queuedLeft.abort();
		await expect( queued ).rejects.toThrow();
		await voice.left;

		const streamingLeft = new AbortController();
		const streaming = await speak( origin, { text: 'stream', speaker: SPEAKER }, streamingLeft.signal );
		await streaming.body.getReader().read();
		streamingLeft.abort();
		await voice.streamLeft;
		expect( warn ).toHaveBeenCalledOnce();

	} );

	it( 'refuses a request outside the contract before Voice sees it', async () => {

		const voice = await fakeVoice();
		const origin = await serve( new VoicePort( voice.url ) );
		for ( const body of [
			'{',
			JSON.stringify( { text: 'hello', speaker: { ...SPEAKER, traits: undefined } } ),
			JSON.stringify( { text: 'hello', speaker: { ...SPEAKER, appearanceSeed: 7 } } ),
			JSON.stringify( { text: 'x'.repeat( 1201 ), speaker: SPEAKER } ),
			JSON.stringify( { text: 'hello', voice: 'A tired narrator', speaker: SPEAKER } )
		] ) {

			const response = await post( origin, '/api/voice', body );
			expect( response.status ).toBe( 400 );
			expect( await response.json() ).toEqual( { error: expect.any( String ), code: 'E_INVALID_REQUEST' } );

		}
		expect( voice.lines ).toEqual( [] );

	} );

	it( 'keeps the Voice failures a browser acts on and reports the rest as the upstream failing', async () => {

		const voice = await fakeVoice();
		const origin = await serve( new VoicePort( voice.url ) );
		const failure = async ( text, port = null ) => {

			const response = await speak( port ? await serve( port ) : origin, { text, speaker: SPEAKER } );
			return [ response.status, ( await response.json() ).code ];

		};
		expect( await failure( 'E_EMPTY_SPEECH' ) ).toEqual( [ 400, 'E_EMPTY_SPEECH' ] );
		expect( await failure( 'E_LOADING' ) ).toEqual( [ 503, 'E_LOADING' ] );
		expect( await failure( 'E_INVALID_REQUEST' ) ).toEqual( [ 502, 'E_UPSTREAM' ] );
		expect( await failure( 'E_UPSTREAM' ) ).toEqual( [ 502, 'E_UPSTREAM' ] );
		expect( await failure( 'hello', new VoicePort( '' ) ) ).toEqual( [ 503, 'E_UNAVAILABLE' ] );
		expect( await failure( 'hello', new VoicePort( await closedUrl() ) ) ).toEqual( [ 503, 'E_UNAVAILABLE' ] );

	} );

	it( 'queues prefetched lines and passes a full queue back as busy', async () => {

		const voice = await fakeVoice();
		const origin = await serve( new VoicePort( voice.url ) );
		const batch = { group: 'dialogue', items: [ { text: 'one', speaker: SPEAKER }, { text: 'two', speaker: SPEAKER } ] };
		const queued = await post( origin, '/api/voice/prefetch', JSON.stringify( batch ) );
		expect( queued.status ).toBe( 202 );
		expect( await queued.json() ).toEqual( { keys: [ KEY, KEY ] } );
		expect( voice.prefetched ).toEqual( [ batch ] );

		const busy = await post( origin, '/api/voice/prefetch', JSON.stringify( { ...batch, group: 'busy' } ) );
		expect( busy.status ).toBe( 429 );
		expect( ( await busy.json() ).code ).toBe( 'E_BUSY' );
		const empty = await post( origin, '/api/voice/prefetch', JSON.stringify( { ...batch, items: [] } ) );
		expect( empty.status ).toBe( 400 );

	} );

	function speak( origin, line, signal ) {

		return post( origin, '/api/voice', JSON.stringify( line ), signal );

	}

	function post( origin, path, body, signal ) {

		return fetch( `${origin}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal } );

	}

	/** Serves the plugin behind connect's prefix rule: the mount path leaves `req.url`. */
	async function serve( port ) {

		let mount;
		let handler;
		voiceRoute( port ).configureServer( { middlewares: { use( path, callback ) { mount = path; handler = callback; } } } );
		return listen( ( request, response ) => {

			const notFound = () => { response.statusCode = 404; response.end(); };
			if ( request.url !== mount && ! request.url.startsWith( `${mount}/` ) ) return notFound();
			request.url = request.url.slice( mount.length ) || '/';
			handler( request, response, notFound );

		} );

	}

	/**
	 * A Voice box whose line text picks the answer: `stream` sends the header and
	 * a frame, then its last frame once released, and notes when its client
	 * leaves; `hit` a whole file; `break` drops the connection mid-body; `queue`
	 * never answers and notes when its client leaves; an error code answers with
	 * that Voice error.
	 */
	async function fakeVoice() {

		const voice = { health: 'ok', lines: [], prefetched: [] };
		let release;
		const released = new Promise( ( resolve ) => release = resolve );
		let waiting, left, streamLeft;
		voice.waiting = new Promise( ( resolve ) => waiting = resolve );
		voice.left = new Promise( ( resolve ) => left = resolve );
		voice.streamLeft = new Promise( ( resolve ) => streamLeft = resolve );
		voice.release = release;
		voice.url = await listen( async ( request, response ) => {

			if ( request.url === '/health' ) return json( response, 200, { status: voice.health } );
			const body = JSON.parse( ( await Array.fromAsync( request ) ).join( '' ) );
			if ( request.url === '/v1/prefetch' ) {

				voice.prefetched.push( body );
				return body.group === 'busy'
					? json( response, 429, { code: 'E_BUSY', message: 'the prefetch queue is full' } )
					: json( response, 202, { keys: body.items.map( () => KEY ) } );

			}
			voice.lines.push( body );
			const headers = { 'Content-Type': 'audio/wav', 'X-Voice-Key': KEY };
			if ( body.text.startsWith( 'E_' ) ) return json( response, body.text === 'E_LOADING' ? 503 : 400, { code: body.text, message: 'refused' } );
			if ( body.text === 'hit' ) {

				response.writeHead( 200, { ...headers, 'X-Voice-Cache': 'hit', 'Content-Length': HEADER.length + FRAME.length } );
				return response.end( Buffer.concat( [ HEADER, FRAME ] ) );

			}
			if ( body.text === 'queue' ) {

				response.on( 'close', left );
				return waiting();

			}
			response.writeHead( 200, { ...headers, 'X-Voice-Cache': 'miss' } );
			response.write( Buffer.concat( [ HEADER, FRAME ] ) );
			if ( body.text === 'break' ) return setTimeout( () => response.destroy(), 20 );
			response.on( 'close', () => response.writableFinished || streamLeft() );
			await released;
			response.end( FRAME );

		} );
		return voice;

	}

	async function listen( handler ) {

		const server = createServer( handler );
		servers.push( server );
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		return `http://127.0.0.1:${server.address().port}`;

	}

	async function closedUrl() {

		const server = createServer();
		await new Promise( ( resolve ) => server.listen( 0, '127.0.0.1', resolve ) );
		const url = `http://127.0.0.1:${server.address().port}`;
		await new Promise( ( resolve ) => server.close( resolve ) );
		return url;

	}

} );

function json( response, status, payload ) {

	response.writeHead( status, { 'Content-Type': 'application/json' } );
	response.end( JSON.stringify( payload ) );

}
