/** Node-side port to the same Python runtime when it runs as a Compose service. */
export class SpeechRuntimeHttp {

	constructor( baseUrl, fetchImpl = globalThis.fetch ) {

		this.baseUrl = baseUrl.replace( /\/$/, '' );
		this.fetchImpl = fetchImpl;

	}

	async request( operation, payload = {}, signal = null ) {

		const body = payload.request ? JSON.stringify( payload.request ) : null;
		const requestId = payload.request?.requestId ?? null;
		let response;
		try {

			response = await this.fetchImpl( `${this.baseUrl}/${operation}`, {
				method: body ? 'POST' : 'GET', signal,
				...( body ? { headers: { 'Content-Type': 'application/json' }, body } : {} )
			} );

		} catch ( error ) {

			if ( error?.name === 'AbortError' ) {

				if ( requestId ) await this.fetchImpl( `${this.baseUrl}/cancel`, {
					method: 'POST', headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { requestId } )
				} ).catch( () => {} );

			}
			throw error;

		}
		const result = await response.json();
		if ( ! response.ok ) throw new Error( result.error ?? `speech service returned ${response.status}` );
		return result;

	}

	dispose() {}

}
