export class NpcVoiceError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'NpcVoiceError';
		this.code = code;
		this.details = details;

	}

}
