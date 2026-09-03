export class QuestActionError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'QuestActionError';
		this.code = code;
		this.details = details;

	}

}
