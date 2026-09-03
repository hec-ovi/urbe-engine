export class ObjectiveRouteError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'ObjectiveRouteError';
		this.code = code;
		this.details = details;

	}

}
