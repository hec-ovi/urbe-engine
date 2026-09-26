/**
 * A companion failure: `E_COMPANION_INPUT` or `E_COMPANION_OUTPUT` for a value
 * that does not match its schema, `E_COMPANION_LINES` for a lines document
 * that lacks a key or fills a template with an unknown name.
 */
export class CompanionError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'CompanionError';
		this.code = code;
		this.details = details;

	}

}
