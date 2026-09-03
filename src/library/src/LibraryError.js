export class LibraryError extends Error {

	constructor( code, message, details = [] ) {

		super( message );
		this.name = 'LibraryError';
		this.code = code;
		this.details = details;

	}

	toJSON() {

		const result = { code: this.code, message: this.message };
		if ( this.details.length ) result.details = [ ...this.details ];
		return result;

	}

}
