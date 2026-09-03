import { readFileSync } from 'node:fs';
import AjvModule from 'ajv/dist/2020.js';
import { CreationError } from './CreationError.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const NAMES = [
	'config', 'generate-city', 'generate-instances', 'generate-quests', 'create-game',
	'city-result', 'instances-result', 'quests-result', 'game-result'
];

export class Boundary {

	constructor() {

		const ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const url of [
			new URL( '../../game/agents/schema/values.schema.json', import.meta.url ),
			new URL( '../../game/agents/schema/continuity-save.schema.json', import.meta.url ),
			new URL( '../../../../simulation/src/schemas/simulation-save.schema.json', import.meta.url ),
			new URL( '../../library/schema/npc-state.schema.json', import.meta.url )
		] ) ajv.addSchema( JSON.parse( readFileSync( url, 'utf8' ) ) );
		for ( const name of [ 'city-descriptor', 'game-descriptor' ] ) {

			ajv.addSchema( JSON.parse( readFileSync( new URL( `../../library/schema/${name}.schema.json`, import.meta.url ), 'utf8' ) ) );

		}
		this.validators = Object.fromEntries( NAMES.map( ( name ) => [
			name,
			ajv.compile( JSON.parse( readFileSync( new URL( `../schema/${name}.schema.json`, import.meta.url ), 'utf8' ) ) )
		] ) );

	}

	assert( name, value ) {

		const validate = this.validators[ name ];
		if ( validate( value ) ) return value;
		const detail = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );
		throw new CreationError( 'E_INVALID_REQUEST', detail );

	}

}
