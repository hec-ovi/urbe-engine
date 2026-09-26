export class SceneryError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'SceneryError';
		this.code = code;
		this.details = details;

	}

}
