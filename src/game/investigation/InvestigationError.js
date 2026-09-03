export class InvestigationError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'InvestigationError';
		this.code = code;
		this.details = details;

	}

}
