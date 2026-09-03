import Ajv2020 from 'ajv/dist/2020.js';
import requestSchema from './schema/talk-request.schema.json' with { type: 'json' };
import responseSchema from './schema/talk-response.schema.json' with { type: 'json' };
import errorSchema from './schema/talk-error.schema.json' with { type: 'json' };

const schemas = { request: requestSchema, response: responseSchema, error: errorSchema };

/** Exact JSON boundary for the development NPC dialogue route. */
export class TalkBoundary {

	constructor() {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		this.validators = Object.fromEntries( Object.entries( schemas ).map( ( [ name, schema ] ) => [ name, ajv.compile( schema ) ] ) );

	}

	input( value ) {

		return this.#validate( 'request', value, 'E_TALK_INPUT' );

	}

	output( value ) {

		return this.#validate( 'response', value, 'E_TALK_OUTPUT' );

	}

	error( value ) {

		return this.#validate( 'error', value, 'E_TALK_OUTPUT' );

	}

	#validate( kind, value, code ) {

		const validate = this.validators[ kind ];
		if ( validate( value ) ) return value;
		const detail = ( validate.errors ?? [] ).map( ( error ) =>
			`${error.instancePath || '/'} ${error.message ?? 'is invalid'}` ).join( '; ' );
		const failure = new Error( `talk ${kind} does not match its contract: ${detail}` );
		failure.code = code;
		throw failure;

	}

}
