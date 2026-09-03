import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';
import { LibraryError } from './LibraryError.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const SCHEMAS = [
	'library-config',
	'query',
	'descriptor-ref',
	'city-descriptor',
	'game-descriptor',
	'npc-state',
	'city-catalog',
	'game-catalog',
	'library-catalog',
	'city-save-result',
	'save-request',
	'save-result',
	'library-error'
];

export class SchemaBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const url of EXTERNAL_SCHEMAS ) this.ajv.addSchema( loadUrl( url ) );
		for ( const name of SCHEMAS ) this.ajv.addSchema( loadSchema( name ) );

	}

	assert( schema, value, code, subject ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:library:${schema}` );
		if ( validate( value ) ) return;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new LibraryError( code, `${subject} does not match its schema`, details );

	}

}

const EXTERNAL_SCHEMAS = [
	new URL( '../../game/agents/schema/values.schema.json', import.meta.url ),
	new URL( '../../game/agents/schema/continuity-save.schema.json', import.meta.url ),
	new URL( '../../game/quests/schema/values.schema.json', import.meta.url ),
	new URL( '../../game/quests/schema/transit-state.schema.json', import.meta.url ),
	new URL( '../../../../simulation/src/schemas/simulation-save.schema.json', import.meta.url )
];

function loadSchema( name ) {

	const url = new URL( `../schema/${name}.schema.json`, import.meta.url );
	return loadUrl( url );

}

function loadUrl( url ) {

	return JSON.parse( readFileSync( url, 'utf8' ) );

}
