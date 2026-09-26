/** Tries a job is read again after the connection drops, before the stage is given up on. */
const READ_ATTEMPTS = 5;

/**
 * Browser transport for the development launcher's closed JSON endpoints.
 * Creation stages run as server jobs: the stage is submitted, then its job is
 * read until it settles, so a stage that builds for minutes holds no request
 * open.
 */
export class HttpLauncherApi {

	/** @param pollMs how long to wait between two reads of a running stage */
	constructor( fetcher = fetch, { pollMs = 2000, wait = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) ) } = {} ) {

		this.fetcher = fetcher;
		this.pollMs = pollMs;
		this.wait = wait;

	}

	catalog() { return this.#call( 'catalog' ); }
	continueGame( id ) { return this.#call( 'continueGame', id ); }
	exportGame( id ) { return this.#call( 'exportGame', id ); }
	importGame( game ) { return this.#call( 'importGame', game ); }
	exportCity( id ) { return this.#call( 'exportCity', id ); }
	generateCity( input ) { return this.#stage( 'generateCity', input ); }
	generateInstances( input ) { return this.#stage( 'generateInstances', input ); }
	generateQuests( input ) { return this.#stage( 'generateQuests', input ); }
	createGame( input ) { return this.#stage( 'createGame', input ); }
	saveCurrent( input ) { return this.#call( 'saveCurrent', input ); }

	#call( method, input ) {

		return this.#request( '/api/launcher', envelope( method, input ) );

	}

	async #stage( method, input ) {

		let job = await this.#request( '/api/creation-jobs', envelope( method, input ) );
		let dropped = 0;
		while ( job.state === 'queued' || job.state === 'running' ) {

			await this.wait( this.pollMs );
			try {

				job = await this.#request( `/api/creation-jobs/${encodeURIComponent( job.id )}` );
				dropped = 0;

			} catch ( error ) {

				// A read the network dropped says nothing about the stage, which runs on.
				if ( ! ( error instanceof TypeError ) || ++ dropped >= READ_ATTEMPTS ) throw error;

			}

		}
		if ( job.state !== 'succeeded' ) throw new Error( job.error?.message ?? `${method} failed` );
		return job.result;

	}

	async #request( url, options = {} ) {

		const response = await Reflect.apply( this.fetcher, globalThis, [ url, options ] );
		const result = await response.json().catch( () => null );
		if ( ! response.ok ) throw new Error( result?.message ?? `launcher request failed with HTTP ${response.status}` );
		return result;

	}

}

function envelope( method, input ) {

	return {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { method, ...( input === undefined ? {} : { input } ) } )
	};

}
