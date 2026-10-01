import Ajv2020 from 'ajv/dist/2020.js';
import walkNetwork from './schema/walk-network.schema.json';
import routeRequest from './schema/route-request.schema.json';
import routeResult from './schema/route-result.schema.json';
import routePlaces from './schema/route-places.schema.json';
import guideUpdate from './schema/guide-update.schema.json';
import guideResult from './schema/guide-result.schema.json';
import { ObjectiveRouteError } from './ObjectiveRouteError.js';

const SCHEMAS = [ walkNetwork, routeRequest, routeResult, routePlaces, guideUpdate, guideResult ];

const PREFIX = 'urn:urbe:engine:objective-routes:';

/**
 * The routes' inputs and outputs held to their schemas: every schema compiled
 * as the boundary is made, and every value checked until `play()` says the game
 * plays. From then on what the guide is handed and hands back each frame is
 * checked only when `play( true )` asks for it, as the `checks=on` query does;
 * an unknown schema name fails either way.
 */
export class ObjectiveRouteBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );
		this.validators = new Map( SCHEMAS.map( ( schema ) => [ schema.$id.slice( PREFIX.length ), this.ajv.getSchema( schema.$id ) ] ) );
		this.checked = true;

	}

	/** The game plays: from now on values pass unchecked, unless `checked`. */
	play( checked = false ) {

		this.checked = checked;

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_OBJECTIVE_ROUTE_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_OBJECTIVE_ROUTE_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.validators.get( name );
		if ( ! validate ) throw new ObjectiveRouteError( code, `unknown objective route schema ${name}` );
		if ( ! this.checked || validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new ObjectiveRouteError( code, `${name} does not match its schema`, details );

	}

}
