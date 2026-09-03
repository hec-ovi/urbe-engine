import Ajv2020 from 'ajv/dist/2020.js';
import walkNetwork from './schema/walk-network.schema.json';
import routeRequest from './schema/route-request.schema.json';
import routeResult from './schema/route-result.schema.json';
import guideUpdate from './schema/guide-update.schema.json';
import guideResult from './schema/guide-result.schema.json';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

const SCHEMAS = [ walkNetwork, routeRequest, routeResult, guideUpdate, guideResult ];

export class ObjectiveRouteBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_OBJECTIVE_ROUTE_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_OBJECTIVE_ROUTE_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:objective-routes:${name}` );
		if ( ! validate ) throw new ObjectiveRouteError( code, `unknown objective route schema ${name}` );
		if ( validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new ObjectiveRouteError( code, `${name} does not match its schema`, details );

	}

}
