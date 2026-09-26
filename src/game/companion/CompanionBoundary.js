import Ajv2020 from 'ajv/dist/2020.js';
import values from './schema/values.schema.json';
import state from './schema/companion-state.schema.json';
import offersRequest from './schema/offers-request.schema.json';
import offers from './schema/offers.schema.json';
import acceptRequest from './schema/accept-request.schema.json';
import toolRequest from './schema/tool-request.schema.json';
import acceptResult from './schema/accept-result.schema.json';
import updateRequest from './schema/update-request.schema.json';
import signals from './schema/signals.schema.json';
import restoreRequest from './schema/restore-request.schema.json';
import talkOffers from './schema/talk-offers.schema.json';
import scenes from './schema/scenes.schema.json';
import { CompanionError } from './CompanionError.js';

const SCHEMAS = [
	values, state, offersRequest, offers, acceptRequest, toolRequest, acceptResult,
	updateRequest, signals, restoreRequest, talkOffers, scenes
];

/** Every value entering or leaving the companion box, checked against its schema. */
export class CompanionBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) { return this.#assert( name, value, 'E_COMPANION_INPUT' ); }
	output( name, value ) { return this.#assert( name, value, 'E_COMPANION_OUTPUT' ); }

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:companion:${name}` );
		if ( validate( value ) ) return value;
		throw new CompanionError(
			code,
			`${name} does not match its schema`,
			validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` )
		);

	}

}
