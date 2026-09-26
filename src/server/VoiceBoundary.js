import Ajv2020 from 'ajv/dist/2020.js';
import requestSchema from './schema/voice-request.schema.json' with { type: 'json' };
import prefetchSchema from './schema/voice-prefetch-request.schema.json' with { type: 'json' };
import keysSchema from './schema/voice-prefetch-response.schema.json' with { type: 'json' };
import capabilitySchema from './schema/voice-capability.schema.json' with { type: 'json' };
import errorSchema from './schema/voice-error.schema.json' with { type: 'json' };
import { VoiceError } from './VoicePort.js';

const SCHEMAS = { line: requestSchema, prefetch: prefetchSchema, keys: keysSchema, capability: capabilitySchema, error: errorSchema };
const INPUTS = new Set( [ 'line', 'prefetch' ] );

/** Exact JSON boundary of the voice routes. */
export class VoiceBoundary {

	constructor() {

		const ajv = new Ajv2020( { allErrors: true, strict: true, schemas: Object.values( SCHEMAS ) } );
		this.validators = Object.fromEntries( Object.entries( SCHEMAS ).map( ( [ kind, schema ] ) => [ kind, ajv.getSchema( schema.$id ) ] ) );

	}

	/**
	 * `value` when it matches the `kind` schema: `line`, `prefetch`, `keys`,
	 * `capability` or `error`. A request that does not throws with status 400,
	 * anything the route answers with 502.
	 */
	check( kind, value ) {

		const validate = this.validators[ kind ];
		if ( validate( value ) ) return value;
		const detail = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );
		const message = `voice ${kind} does not match its contract: ${detail}`;
		throw INPUTS.has( kind ) ? new VoiceError( 400, 'E_INVALID_REQUEST', message ) : new VoiceError( 502, 'E_UPSTREAM', message );

	}

}
