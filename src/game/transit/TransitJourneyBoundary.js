import Ajv2020 from 'ajv/dist/2020.js';
import values from './schema/values.schema.json';
import transitData from './schema/transit-data.schema.json';
import journeyState from './schema/journey-state.schema.json';
import serviceQuery from './schema/service-query.schema.json';
import serviceList from './schema/service-list.schema.json';
import boardRequest from './schema/board-request.schema.json';
import boardResult from './schema/board-result.schema.json';
import journeyUpdateRequest from './schema/journey-update-request.schema.json';
import journeyUpdateResult from './schema/journey-update-result.schema.json';
import disembarkRequest from './schema/disembark-request.schema.json';
import disembarkResult from './schema/disembark-result.schema.json';
import gameplayUpdateRequest from './schema/gameplay-update-request.schema.json';
import gameplayServiceSelection from './schema/gameplay-service-selection.schema.json';
import gameplayView from './schema/gameplay-view.schema.json';
import gameplayAction from './schema/gameplay-action.schema.json';

const SCHEMAS = [
	values,
	transitData,
	journeyState,
	serviceQuery,
	serviceList,
	boardRequest,
	boardResult,
	journeyUpdateRequest,
	journeyUpdateResult,
	disembarkRequest,
	disembarkResult,
	gameplayUpdateRequest,
	gameplayServiceSelection,
	gameplayView,
	gameplayAction
];

/** Runtime boundary for every value entering or leaving TransitJourney. */
export class TransitJourneyBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	valid( name, value ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:transit:${name}` );
		return Boolean( validate?.( value ) );

	}

}
