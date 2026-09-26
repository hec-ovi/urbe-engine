import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { closing, messageOf, readJson, sendJson } from './routeHttp.js';
import { VoiceBoundary } from './VoiceBoundary.js';
import { VoiceError, VoicePort } from './VoicePort.js';

/** What the browser learns about a line besides its audio: which render it is and whether it was cached. */
const PASSED_HEADERS = [ 'content-length', 'x-voice-key', 'x-voice-cache' ];
/** The largest voice request body: a batch of lines rendered ahead with their speakers. */
const MAX_BYTES = 256 * 1024;

/**
 * Vite plugin for NPC speech over the Voice box. GET /api/voice says whether
 * lines can be spoken now, POST /api/voice streams one line's WAV through as
 * it renders, POST /api/voice/prefetch queues lines the player may hear next
 * and DELETE /api/voice/prefetch/<group> drops those a group still has.
 * Every request is checked before it reaches Voice.
 */
export function voiceRoute( port = VoicePort.fromEnv() ) {

	const boundary = new VoiceBoundary();
	const routes = { 'GET /': capability, 'POST /': speak, 'POST /prefetch': prefetch, 'DELETE /prefetch/:group': cancel };

	return {
		name: 'voice-route',
		configureServer( server ) {

			server.middlewares.use( '/api/voice', ( req, res, next ) => {

				const { pathname } = new URL( req.url, 'http://voice' );
				const group = pathname.match( /^\/prefetch\/([^/]*)$/ )?.[ 1 ];
				const route = routes[ `${req.method} ${group === undefined ? pathname : '/prefetch/:group'}` ];
				if ( ! route ) return next();
				route( req, res, group ).catch( ( error ) => fail( res, error ) );

			} );

		}
	};

	async function capability( _req, res ) {

		const status = await port.status();
		sendJson( res, 200, boundary.check( 'capability', { enabled: status === 'ok', status } ) );

	}

	/**
	 * Answers once Voice has the first audio and pipes the rest unbuffered. A
	 * line that breaks off, or a browser that leaves, destroys the response
	 * before its body ends, so a partial line never reads as a whole one; the
	 * browser leaving also stops the render, queued or streaming. Only a break
	 * while the browser still listens is logged: the upstream read fails
	 * before the response is destroyed and the signal aborts.
	 */
	async function speak( req, res ) {

		const line = await admit( req, 'line' );
		const signal = closing( res );
		const upstream = await port.speak( line, { signal } );
		const headers = PASSED_HEADERS.filter( ( name ) => upstream.headers.has( name ) ).map( ( name ) => [ name, upstream.headers.get( name ) ] );
		res.writeHead( 200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', ...Object.fromEntries( headers ) } );
		const body = Readable.fromWeb( upstream.body );
		body.once( 'error', ( error ) => signal.aborted || console.warn( 'voice: a line broke off:', messageOf( error ) ) );
		await pipeline( body, res ).catch( () => {} );

	}

	async function prefetch( req, res ) {

		const batch = await admit( req, 'prefetch' );
		const keys = await port.prefetch( batch, { signal: closing( res ) } );
		sendJson( res, 202, boundary.check( 'keys', keys ) );

	}

	/** `encoded` is the group as the path carries it. The cancel goes through even when the browser leaves. */
	async function cancel( _req, res, encoded ) {

		let group;
		try { group = decodeURIComponent( encoded ); }
		catch ( error ) { throw new VoiceError( 400, 'E_INVALID_REQUEST', `voice group is not URL-encoded: ${messageOf( error )}` ); }
		await port.cancel( boundary.check( 'group', group ) );
		res.writeHead( 204 ).end();

	}

	async function admit( req, kind ) {

		let value;
		try { value = await readJson( req, 'voice', MAX_BYTES ); }
		catch ( error ) { throw new VoiceError( error.status ?? 400, 'E_INVALID_REQUEST', messageOf( error ) ); }
		return boundary.check( kind, value );

	}

	/** A browser that already left, or a response already under way, has nobody to answer. */
	function fail( res, error ) {

		if ( error?.name === 'AbortError' || res.headersSent || res.destroyed ) return res.destroy();
		const failure = error instanceof VoiceError ? error : new VoiceError( 502, 'E_UPSTREAM', messageOf( error ) );
		if ( ! ( error instanceof VoiceError ) ) console.warn( 'voice:', failure.message );
		sendJson( res, failure.status, boundary.check( 'error', { error: failure.message, code: failure.code } ) );

	}

}
