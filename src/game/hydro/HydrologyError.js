export class HydrologyError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'HydrologyError';
		this.code = code;
		this.details = details;

	}

}
