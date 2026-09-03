import Ajv2020 from 'ajv/dist/2020.js';
import valuesSchema from './schema/values.schema.json' with { type: 'json' };
import hydrologyPlanSchema from './schema/hydrology-plan.schema.json' with { type: 'json' };
import materialBindingsSchema from './schema/material-bindings.schema.json' with { type: 'json' };
import updateSchema from './schema/update.schema.json' with { type: 'json' };
import handoffSchema from './schema/handoff.schema.json' with { type: 'json' };
import runtimeSummarySchema from './schema/runtime-summary.schema.json' with { type: 'json' };
import waterMaterialSchema from './schema/water-material.schema.json' with { type: 'json' };
import { HydrologyError } from './HydrologyError.js';

const SCHEMAS = [
	valuesSchema,
	hydrologyPlanSchema,
	materialBindingsSchema,
	updateSchema,
	handoffSchema,
	runtimeSummarySchema,
	waterMaterialSchema
];

const NAMES = Object.freeze( {
	'hydrology-plan': hydrologyPlanSchema.$id,
	'material-bindings': materialBindingsSchema.$id,
	update: updateSchema.$id,
	handoff: handoffSchema.$id,
	'runtime-summary': runtimeSummarySchema.$id,
	'water-material': waterMaterialSchema.$id
} );

/** Exact JSON boundary before geometry or material work can begin. */
export class HydrologyBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_HYDRO_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_HYDRO_OUTPUT' );

	}

	material( value ) {

		return this.#assert( 'water-material', value, 'E_HYDRO_MATERIAL' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( NAMES[ name ] );
		if ( ! validate ) throw new HydrologyError( code, `Unknown hydrology schema ${name}` );
		if ( validate( value ) ) return value;
		const details = ( validate.errors ?? [] ).map( ( error ) => ( {
			path: error.instancePath || '/',
			keyword: error.keyword,
			message: error.message ?? 'invalid value'
		} ) );
		throw new HydrologyError( code, `Hydrology ${name} does not match its contract`, details );

	}

}
