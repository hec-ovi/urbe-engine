export class QuestBundleError extends Error {

	constructor( code, message, details = [] ) {

		super( `${code}: ${message}` );
		this.name = 'QuestBundleError';
		this.code = code;
		this.details = details;

	}

}
