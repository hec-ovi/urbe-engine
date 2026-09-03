import Ajv2020 from 'ajv/dist/2020.js';
import interactionRequest from './schema/interaction-request.schema.json';
import interactionResult from './schema/interaction-result.schema.json';
import interactionTargets from './schema/interaction-targets.schema.json';
import activeObjective from './schema/active-objective.schema.json';
import targetQuery from './schema/target-query.schema.json';
import values from './schema/values.schema.json';
import { QuestActionError } from './QuestActionError.js';

const SCHEMAS = [ values, targetQuery, interactionRequest, interactionTargets, activeObjective, interactionResult ];

export class QuestActionBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_QUEST_ACTION_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_QUEST_ACTION_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:quest-actions:${name}` );
		if ( ! validate ) throw new QuestActionError( code, `unknown quest action schema ${name}` );
		if ( validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new QuestActionError( code, `${name} does not match its schema`, details );

	}

}
