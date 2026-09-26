import { messageOf } from './routeHttp.js';

/** Where native `npm run play` finds the Voice box: the port Compose publishes it on. */
const DEFAULT_BASE_URL = 'http://localhost:5308';
const HEALTH_TIMEOUT_MS = 3000;
/** The Voice failures the browser can act on keep their status; any other is the upstream's failure. */
const PASSED = { E_EMPTY_SPEECH: 400, E_BUSY: 429, E_LOADING: 503 };

/** A failure the voice routes answer with: an HTTP status and a code from voice-error.schema.json. */
export class VoiceError extends Error {

	constructor( status, code, message ) {

		super( message );
		this.status = status;
		this.code = code;

	}

	static unavailable( message ) {

		return new VoiceError( 503, 'E_UNAVAILABLE', message );

	}

}

/**
 * HTTP client of the Voice box (voice/CONTRACT.md): its health, streamed
 * speech, prefetch and prefetch cancel. `VOICE_BASE_URL` names it; empty
 * turns voice off.
 */
export class VoicePort {

	static fromEnv( env = process.env ) {

		return new VoicePort( env.VOICE_BASE_URL ?? DEFAULT_BASE_URL );

	}

	constructor( baseUrl ) {

		this.baseUrl = baseUrl.replace( /\/+$/, '' );

	}

	/** The Voice health (`ok`, `loading`, `degraded`), `unreachable` when it does not answer, or `off`. */
	async status() {

		if ( ! this.baseUrl ) return 'off';
		try {

			const response = await fetch( `${this.baseUrl}/health`, { signal: AbortSignal.timeout( HEALTH_TIMEOUT_MS ) } );
			const { status } = await response.json();
			return [ 'ok', 'loading' ].includes( status ) ? status : 'degraded';

		} catch {

			return 'unreachable';

		}

	}

	/**
	 * The line's WAV response once its first audio exists; its body streams the
	 * rest. A body read that fails means the line broke off.
	 */
	speak( line, { signal } = {} ) {

		return this.#send( 'POST', '/v1/speak', line, signal );

	}

	/** `{ keys }` once the lines are queued. */
	async prefetch( batch, { signal } = {} ) {

		return ( await this.#send( 'POST', '/v1/prefetch', batch, signal ) ).json();

	}

	/** Resolves once Voice has dropped what `group` still has queued or rendering. */
	async cancel( group ) {

		await this.#send( 'DELETE', `/v1/prefetch/${encodeURIComponent( group )}` );

	}

	async #send( method, path, body, signal ) {

		if ( ! this.baseUrl ) throw VoiceError.unavailable( 'voice is off: VOICE_BASE_URL is empty' );
		let response;
		try {

			response = await fetch( `${this.baseUrl}${path}`, {
				method, signal, ...( body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( body ) } )
			} );

		} catch ( error ) {

			if ( signal?.aborted ) throw error;
			throw VoiceError.unavailable( `voice service unreachable at ${this.baseUrl}: ${messageOf( error.cause ?? error )}` );

		}
		if ( response.ok ) return response;
		const { code, message } = await response.json().catch( () => ( {} ) );
		const status = PASSED[ code ];
		throw new VoiceError( status ?? 502, status ? code : 'E_UPSTREAM', `voice ${response.status}${code ? ` ${code}` : ''}: ${message || 'no message'}` );

	}

}
