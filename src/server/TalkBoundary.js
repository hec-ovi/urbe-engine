import Ajv2020 from 'ajv/dist/2020.js';
import requestSchema from './schema/talk-request.schema.json' with { type: 'json' };
import errorSchema from './schema/talk-error.schema.json' with { type: 'json' };
import eventSchema from './schema/talk-stream-event.schema.json' with { type: 'json' };
import memorySchema from './schema/talk-memory.schema.json' with { type: 'json' };
import dialogueMemorySchema from '../library/schema/dialogue-memory.schema.json' with { type: 'json' };

const schemas = { request: requestSchema, error: errorSchema, event: eventSchema, memory: memorySchema };

/** Exact JSON boundary for the development NPC dialogue routes. */
export class TalkBoundary {

	constructor() {

		const ajv = new Ajv2020( { allErrors: true, strict: true } ).addSchema( [ ...Object.values( schemas ), dialogueMemorySchema ] );
		this.validators = Object.fromEntries( Object.entries( schemas ).map( ( [ name, schema ] ) => [ name, ajv.getSchema( schema.$id ) ] ) );
		this.validators.kept = ajv.getSchema( `${memorySchema.$id}#/$defs/kept` );
		this.validators.out = ajv.getSchema( `${requestSchema.$id}#/properties/out` );

	}

	input( value ) {

		return this.#validate( 'request', value, 'E_TALK_INPUT' );

	}

	error( value ) {

		return this.#validate( 'error', value, 'E_TALK_OUTPUT' );

	}

	/** One line of the streamed reply. */
	event( value ) {

		return this.#validate( 'event', value, 'E_TALK_OUTPUT' );

	}

	/** A save's dialogue memory for one world, as a PUT hands it over. */
	memory( value ) {

		return this.#validate( 'memory', value, 'E_TALK_INPUT' );

	}

	/** A world's dialogue memory as the server keeps it, as a GET answers it. */
	kept( value ) {

		return this.#validate( 'kept', value, 'E_TALK_OUTPUT' );

	}

	/** The served world a memory request names. */
	out( value ) {

		return this.#validate( 'out', value, 'E_TALK_INPUT' );

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
