import { chatDeltas } from '../../../quests/dist/index.js';

const DEFAULT_BASE_URL = 'http://localhost:8080/v1';
const DEFAULT_TIMEOUT_MS = 60000;

/**
 * The quests StreamingLLMPort over an OpenAI-compatible Chat Completions
 * server (llama.cpp, vLLM, Ollama or a hosted API). Every request streams, so
 * one reader, one key and one timeout serve both `complete` and `stream`. The
 * text passes through as the model wrote it: quests' shared markup stage drops
 * think blocks and template tokens. No output caps are ever sent.
 */
export class OpenAIPort {

	/**
	 * The port the environment names: LLM_BASE_URL, LLM_MODEL (empty: the first
	 * model the server lists), LLM_API_KEY (sent as a bearer token when set) and
	 * LLM_TIMEOUT_MS.
	 */
	static fromEnv( env = process.env ) {

		const timeoutMs = Number( env.LLM_TIMEOUT_MS );
		return new OpenAIPort( env.LLM_BASE_URL || DEFAULT_BASE_URL, {
			model: env.LLM_MODEL,
			apiKey: env.LLM_API_KEY,
			timeoutMs: timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS
		} );

	}

	#headers;

	/** @param timeoutMs a request fails once the server has sent nothing for this long */
	constructor( baseUrl, { model = null, apiKey = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {} ) {

		this.baseUrl = baseUrl.replace( /\/+$/, '' );
		this.model = model || null;
		this.timeoutMs = timeoutMs;
		this.#headers = { 'Content-Type': 'application/json', ...( apiKey ? { Authorization: `Bearer ${apiKey}` } : {} ) };
		/** Server-reported token totals across calls; completion includes any thinking the server does not return. */
		this.usage = { calls: 0, promptTokens: 0, completionTokens: 0 };

	}

	/** The whole text of one reply. */
	async complete( { system, prompt } ) {

		let text = '';
		for await ( const delta of this.stream( { messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: prompt }
		] } ) ) text += delta.content ?? '';
		return text;

	}

	/**
	 * Streams one chat request (`messages` and optional `tools`) and yields each
	 * choice delta, text and tool-call fragments alike. Aborting `signal`, or
	 * returning early, ends the request.
	 */
	async *stream( chat, { signal } = {} ) {

		const idle = new IdleAbort( this.timeoutMs, signal );
		try {

			const model = this.model ??= await this.#firstModel( idle.signal );
			const response = await this.#fetch( '/chat/completions', idle.signal, {
				method: 'POST',
				body: JSON.stringify( { model, ...chat, stream: true, stream_options: { include_usage: true } } )
			} );
			this.usage.calls += 1;
			yield* chatDeltas( response.body && idle.watch( response.body ), ( usage ) => {

				this.usage.promptTokens += usage.prompt_tokens ?? 0;
				this.usage.completionTokens += usage.completion_tokens ?? 0;

			} );

		} catch ( error ) {

			throw idle.fired ? new Error( `model server at ${this.baseUrl} sent nothing for ${this.timeoutMs} ms` ) : error;

		} finally {

			idle.stop();

		}

	}

	async #firstModel( signal ) {

		const data = await ( await this.#fetch( '/models', signal ) ).json();
		const id = data.data?.[ 0 ]?.id;
		if ( ! id ) throw new Error( `model server at ${this.baseUrl} lists no model` );
		return id;

	}

	async #fetch( path, signal, init = {} ) {

		const response = await fetch( `${this.baseUrl}${path}`, { ...init, signal, headers: this.#headers } );
		if ( response.ok ) return response;
		const detail = ( await response.text().catch( () => '' ) ).trim().slice( 0, 300 );
		throw new Error( `model server ${response.status} at ${this.baseUrl}${detail ? `: ${detail}` : ''}` );

	}

}

/** Aborts once nothing has arrived for `ms`, or when the caller's signal aborts. */
class IdleAbort {

	#controller = new AbortController();
	#timer = null;
	fired = false;

	constructor( ms, outer ) {

		this.ms = ms;
		this.signal = outer ? AbortSignal.any( [ outer, this.#controller.signal ] ) : this.#controller.signal;
		this.#touch();

	}

	/** The body's chunks, each one restarting the clock. */
	async *watch( body ) {

		for await ( const chunk of body ) {

			this.#touch();
			yield chunk;

		}

	}

	stop() {

		clearTimeout( this.#timer );

	}

	#touch() {

		clearTimeout( this.#timer );
		this.#timer = setTimeout( () => {

			this.fired = true;
			this.#controller.abort();

		}, this.ms );

	}

}
