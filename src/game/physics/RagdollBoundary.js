import Ajv2020 from 'ajv/dist/2020.js';
import impactSchema from './schema/ragdoll-impact.schema.json' with { type: 'json' };
import summarySchema from './schema/ragdoll-summary.schema.json' with { type: 'json' };
import impactEventsSchema from './schema/impact-events.schema.json' with { type: 'json' };
import { RagdollError } from './RagdollError.js';

const NAMES = Object.freeze( {
	impact: impactSchema.$id,
	summary: summarySchema.$id,
	'impacts': impactEventsSchema.$id
} );

/** JSON edge around the live Rapier and Three.js objects. */
export class RagdollBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		this.ajv.addSchema( impactSchema );
		this.ajv.addSchema( summarySchema );
		this.ajv.addSchema( impactEventsSchema );

	}

	input( value ) {

		return this.#assert( 'impact', value, 'E_RAGDOLL_INPUT' );

	}

	output( value ) {

		return this.#assert( 'summary', value, 'E_RAGDOLL_OUTPUT' );

	}

	impacts( value ) {

		return this.#assert( 'impacts', value, 'E_RAGDOLL_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( NAMES[ name ] );
		if ( validate( value ) ) return value;
		const details = ( validate.errors ?? [] ).map( ( error ) => ( {
			path: error.instancePath || '/', keyword: error.keyword,
			message: error.message ?? 'invalid value'
		} ) );
		throw new RagdollError( code, `Ragdoll ${name} does not match its contract`, details );

	}

}
