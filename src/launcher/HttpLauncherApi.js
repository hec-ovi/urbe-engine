/** Browser transport for the development launcher's closed JSON endpoint. */
export class HttpLauncherApi {

	constructor( fetcher = fetch ) {

		this.fetcher = fetcher;

	}

	catalog() { return this.#call( 'catalog' ); }
	continueGame( id ) { return this.#call( 'continueGame', id ); }
	exportGame( id ) { return this.#call( 'exportGame', id ); }
	importGame( game ) { return this.#call( 'importGame', game ); }
	exportCity( id ) { return this.#call( 'exportCity', id ); }
	generateCity( input ) { return this.#call( 'generateCity', input ); }
	generateInstances( input ) { return this.#call( 'generateInstances', input ); }
	generateQuests( input ) { return this.#call( 'generateQuests', input ); }
	createGame( input ) { return this.#call( 'createGame', input ); }
	saveCurrent( input ) { return this.#call( 'saveCurrent', input ); }

	async #call( method, input ) {

		const response = await Reflect.apply( this.fetcher, globalThis, [ '/api/launcher', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { method, ...( input === undefined ? {} : { input } ) } )
		} ] );
		const result = await response.json().catch( () => null );
		if ( ! response.ok ) throw new Error( result?.message ?? `launcher request failed with HTTP ${response.status}` );
		return result;

	}

}
