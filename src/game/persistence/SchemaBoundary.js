import Ajv2020 from 'ajv/dist/2020.js';
import gameDescriptor from '../../library/schema/game-descriptor.schema.json';
import npcState from '../../library/schema/npc-state.schema.json';
import npcValues from '../agents/schema/values.schema.json';
import continuitySave from '../agents/schema/continuity-save.schema.json';
import simulationSave from '../../../../simulation/src/schemas/simulation-save.schema.json';
import gameState from './schema/game-state.schema.json';
import liveState from './schema/live-state.schema.json';
import savePayload from './schema/save-current-payload.schema.json';
import saveResult from './schema/save-result.schema.json';
import values from './schema/values.schema.json';
import { PersistenceError } from './PersistenceError.js';

const SCHEMAS = [ npcValues, continuitySave, simulationSave, npcState, gameDescriptor, values, gameState, liveState, savePayload, saveResult ];

export class SchemaBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	assert( schema, value, code, subject ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:game-persistence:${schema}` );
		if ( validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new PersistenceError( code, `${subject} does not match its schema`, details );

	}

}
