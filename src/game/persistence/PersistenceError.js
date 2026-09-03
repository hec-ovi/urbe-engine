export class PersistenceError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'PersistenceError';
		this.code = code;
		this.details = details;

	}

}
