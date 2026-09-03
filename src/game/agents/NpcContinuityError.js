export class NpcContinuityError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'NpcContinuityError';
		this.code = code;
		this.details = details;

	}

}
