/**
 * The browser side of NPC speech: the dev server's /api/voice routes
 * (server/CONTRACT.md). A failure throws an Error whose `status` and `code`
 * are what the server answered.
 */
export class VoiceClient {

	/** `{ enabled, status }`; a server that does not answer reads as `{ enabled: false, status: 'unreachable' }`. */
	async capability() {

		try {

			const response = await fetch( '/api/voice' );
			if ( response.ok ) return await response.json();

		} catch { /* the dev server itself is gone */ }
		return { enabled: false, status: 'unreachable' };

	}

	/** The line's WAV response once its first audio exists; reading its body can still fail if the line breaks off. */
	speak( line, { signal } = {} ) {

		return this.#post( '/api/voice', line, signal );

	}

	/** Queues lines the player may hear next; `group` names the batch a newer one replaces. */
	async prefetch( group, items ) {

		await this.#post( '/api/voice/prefetch', { group, items } );

	}

	async #post( path, body, signal ) {

		const response = await fetch( path, {
			method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( body )
		} );
		if ( response.ok ) return response;
		const { error, code } = await response.json().catch( () => ( {} ) );
		throw Object.assign( new Error( error || `voice ${response.status}` ), { status: response.status, code } );

	}

}
