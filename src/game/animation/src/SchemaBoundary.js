import Ajv2020 from 'ajv/dist/2020.js';
import commandSchema from '../schema/command.schema.json' with { type: 'json' };
import configSchema from '../schema/coordinator-config.schema.json' with { type: 'json' };
import reportSchema from '../schema/requirements-report.schema.json' with { type: 'json' };
import resultSchema from '../schema/command-result.schema.json' with { type: 'json' };
import snapshotSchema from '../schema/snapshot.schema.json' with { type: 'json' };
import valuesSchema from '../schema/values.schema.json' with { type: 'json' };
import { AnimationCoordinationError } from './AnimationError.js';

const ajv = new Ajv2020( { allErrors: true, strict: true } );

for ( const schema of [ valuesSchema, configSchema, commandSchema, snapshotSchema, reportSchema, resultSchema ] ) {

	ajv.addSchema( schema );

}

const validators = Object.freeze( {
	config: ajv.getSchema( configSchema.$id ),
	command: ajv.getSchema( commandSchema.$id ),
	snapshot: ajv.getSchema( snapshotSchema.$id ),
	report: ajv.getSchema( reportSchema.$id ),
	result: ajv.getSchema( resultSchema.$id )
} );

export function validateInput( kind, value ) {

	validate( kind, value, 'E_ANIMATION_INPUT' );

}

export function validateOutput( kind, value ) {

	validate( kind, value, 'E_ANIMATION_OUTPUT' );

}

function validate( kind, value, code ) {

	const validator = validators[ kind ];
	if ( ! validator ) throw new AnimationCoordinationError( code, `Unknown animation schema ${kind}` );
	if ( validator( value ) ) return;

	const details = ( validator.errors ?? [] ).map( ( error ) => ( {
		path: error.instancePath || '/',
		keyword: error.keyword,
		message: error.message ?? 'invalid value'
	} ) );

	throw new AnimationCoordinationError( code, `Animation ${kind} does not match its contract`, details );

}
