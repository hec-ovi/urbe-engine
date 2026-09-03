import Ajv2020 from 'ajv/dist/2020.js';
import interactionRequest from './schema/interaction-request.schema.json';
import interactionResult from './schema/interaction-result.schema.json';
import interactionTargets from './schema/interaction-targets.schema.json';
import sceneAssembly from './schema/scene-assembly.schema.json';
import sceneRequest from './schema/scene-request.schema.json';
import sceneState from './schema/scene-state.schema.json';
import targetQuery from './schema/target-query.schema.json';
import values from './schema/values.schema.json';
import { InvestigationError } from './InvestigationError.js';

const SCHEMAS = [
	values,
	sceneRequest,
	sceneAssembly,
	sceneState,
	targetQuery,
	interactionTargets,
	interactionRequest,
	interactionResult
];

/** Fail-closed JSON boundary for authored scenes, assembly and saved progress. */
export class InvestigationBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_INVESTIGATION_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_INVESTIGATION_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:investigation:${name}` );
		if ( ! validate ) throw new InvestigationError( code, `unknown investigation schema ${name}` );
		if ( validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new InvestigationError( code, `${name} does not match its schema`, details );

	}

}
