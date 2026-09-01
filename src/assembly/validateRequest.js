import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const SCHEMA_PATH = new URL( '../../../exterior/schemas/building-request.schema.json', import.meta.url );

let validator = null;

/**
 * Validates a request against exterior's building-request schema (draft 2020-12).
 * @returns [] when valid, else ajv error objects.
 */
export function validateRequest( request ) {

	if ( ! validator ) {

		const schema = JSON.parse( readFileSync( SCHEMA_PATH, 'utf8' ) );
		validator = new Ajv2020( { allErrors: true } ).compile( schema );

	}

	return validator( request ) ? [] : validator.errors;

}
