export class RagdollError extends Error {

	constructor( code, message, details = [] ) {

		super( `${code}: ${message}` );
		this.name = 'RagdollError';
		this.code = code;
		this.details = details;

	}

}
