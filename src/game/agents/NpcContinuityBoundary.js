import Ajv2020 from 'ajv/dist/2020.js';
import values from './schema/values.schema.json';
import followStart from './schema/follow-start.schema.json';
import followUpdate from './schema/follow-update.schema.json';
import followStop from './schema/follow-stop.schema.json';
import actorState from './schema/actor-state.schema.json';
import continuitySave from './schema/continuity-save.schema.json';
import places from './schema/places.schema.json';
import movementNetwork from './schema/movement-network.schema.json';
import appearanceRequest from './schema/appearance-request.schema.json';
import unloadRequest from './schema/unload-request.schema.json';
import actorStateOrNull from './schema/actor-state-or-null.schema.json';
import conversationStart from './schema/conversation-start.schema.json';
import conversationStop from './schema/conversation-stop.schema.json';
import visibleUpdate from './schema/visible-update.schema.json';
import actorStates from './schema/actor-states.schema.json';
import { NpcContinuityError } from './NpcContinuityError.js';

const SCHEMAS = [
	values, appearanceRequest, unloadRequest, followStart, followUpdate, followStop,
	conversationStart, conversationStop,
	visibleUpdate, actorState, actorStateOrNull, actorStates, continuitySave, places, movementNetwork
];

export class NpcContinuityBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) { return this.#assert( name, value, 'E_NPC_INPUT' ); }
	output( name, value ) { return this.#assert( name, value, 'E_NPC_OUTPUT' ); }

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:npc-agents:${name}` );
		if ( ! validate ) throw new NpcContinuityError( code, `unknown NPC continuity schema ${name}` );
		if ( validate( value ) ) return value;
		throw new NpcContinuityError(
			code,
			`${name} does not match its schema`,
			validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` )
		);

	}

}
