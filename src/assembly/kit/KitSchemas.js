import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';
import { SchemaFiles } from '../SchemaFiles.js';

const Ajv2020 = AjvModule.default ?? AjvModule;

/** Exterior publishes what the kit path asks for and what it gets back; the table is ours. */
const PLACEMENTS_FILE = new URL( './kit-placements.schema.json', import.meta.url );
const PLAN_FILE = new URL( './kit-plan.schema.json', import.meta.url );
const REQUEST_FILE = new URL( '../../../../exterior/schemas/kit-request.schema.json', import.meta.url );
const PLACEMENT_FILE = new URL( '../../../../exterior/schemas/placement.schema.json', import.meta.url );
const KIT_ID = 'https://urbe.dev/exterior/kit.schema.json';
const REQUEST_ID = 'https://urbe.dev/exterior/kit-request.schema.json';
const PLACEMENT_ID = 'https://urbe.dev/exterior/placement.schema.json';
const PLACEMENTS_ID = 'urbe/engine/kit-placements';
const PLAN_ID = 'urbe/engine/kit-plan';

let ajv = null;

function instance() {

	if ( ! ajv ) {

		// Exterior's published schemas narrow $ref'd shapes without repeating their
		// types, which ajv only warns about.
		ajv = new Ajv2020( { allErrors: true, strictTypes: false } );
		// Exterior's request and placement schemas arrive with their own file
		// dependencies; our table then refers to them by their published ids.
		const files = new SchemaFiles( ajv );
		files.add( REQUEST_FILE );
		files.add( PLACEMENT_FILE );
		ajv.addSchema( JSON.parse( readFileSync( PLACEMENTS_FILE, 'utf8' ) ) );
		ajv.addSchema( JSON.parse( readFileSync( PLAN_FILE, 'utf8' ) ) );

	}

	return ajv;

}

/** @returns [] when valid, else ajv error objects. */
export function validateKitManifest( kit ) {

	return check( KIT_ID, kit );

}

/** @returns [] when valid, else ajv error objects. */
export function validateKitRequest( request ) {

	return check( REQUEST_ID, request );

}

/** @returns [] when valid, else ajv error objects. */
export function validatePlacementPlan( plan ) {

	return check( PLACEMENT_ID, plan );

}

/** @returns [] when valid, else ajv error objects. */
export function validateKitPlacements( document ) {

	return check( PLACEMENTS_ID, document );

}

/** @returns [] when valid, else ajv error objects. */
export function validateKitPlan( document ) {

	return check( PLAN_ID, document );

}

/** One readable line out of ajv errors. */
export function schemaMessage( errors ) {

	return errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );

}

function check( id, value ) {

	const validate = instance().getSchema( id );

	return validate( value ) ? [] : validate.errors;

}
