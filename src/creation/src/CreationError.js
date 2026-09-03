export class CreationError extends Error {

	constructor( code, message, status = 400 ) {

		super( message );
		this.name = 'CreationError';
		this.code = code;
		this.status = status;

	}

}
