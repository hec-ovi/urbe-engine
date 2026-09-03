export class AnimationCoordinationError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'AnimationCoordinationError';
		this.code = code;
		this.details = details;

	}

}
