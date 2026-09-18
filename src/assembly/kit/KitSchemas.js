import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;

/** Both documents the kit path writes are ours: the record and the plan index. */
const PLACEMENTS_FILE = new URL( './kit-placements.schema.json', import.meta.url );
const PLANS_FILE = new URL( './kit-plans.schema.json', import.meta.url );
const PLACEMENTS_ID = 'urbe/engine/kit-placements';
const PLANS_ID = 'urbe/engine/kit-plans';

let ajv = null;

function instance() {

	if ( ! ajv ) {

		ajv = new Ajv2020( { allErrors: true, strictTypes: false } );
		ajv.addSchema( JSON.parse( readFileSync( PLACEMENTS_FILE, 'utf8' ) ) );
		ajv.addSchema( JSON.parse( readFileSync( PLANS_FILE, 'utf8' ) ) );

	}

	return ajv;

}

/** @returns [] when valid, else ajv error objects. */
export function validateKitPlacements( document ) {

	return check( PLACEMENTS_ID, document );

}

/** @returns [] when valid, else ajv error objects. */
export function validatePlanIndex( document ) {

	return check( PLANS_ID, document );

}

/** One readable line out of ajv errors. */
export function schemaMessage( errors ) {

	return errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );

}

function check( id, value ) {

	const validate = instance().getSchema( id );

	return validate( value ) ? [] : validate.errors;

}
