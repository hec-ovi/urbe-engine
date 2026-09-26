import Ajv2020 from 'ajv/dist/2020.js';
import missionAssetValues from '../../mission-assets/schema/values.schema.json' with { type: 'json' };
import missionAssetAssembly from '../../mission-assets/schema/asset-assembly.schema.json' with { type: 'json' };
import investigationValues from '../investigation/schema/values.schema.json' with { type: 'json' };
import values from './schema/values.schema.json' with { type: 'json' };
import sceneSpec from './schema/scene-spec.schema.json' with { type: 'json' };
import sceneSpecs from './schema/scene-specs.schema.json' with { type: 'json' };
import sceneState from './schema/scene-state.schema.json' with { type: 'json' };
import savedScenery from './schema/saved-scenery.schema.json' with { type: 'json' };
import stagingAssembly from './schema/staging-assembly.schema.json' with { type: 'json' };
import capabilities from './schema/capabilities.schema.json' with { type: 'json' };
import { SceneryError } from './SceneryError.js';

const SCHEMAS = [
	missionAssetValues, missionAssetAssembly, investigationValues, values,
	sceneSpec, sceneSpecs, sceneState, savedScenery, stagingAssembly, capabilities
];

/** Fail-closed JSON boundary for scene specs, staged assemblies and saved lifecycles. */
export class SceneryBoundary {

	constructor() {

		this.ajv = new Ajv2020( { allErrors: true, strict: true } );
		for ( const schema of SCHEMAS ) this.ajv.addSchema( schema );

	}

	input( name, value ) {

		return this.#assert( name, value, 'E_SCENERY_INPUT' );

	}

	output( name, value ) {

		return this.#assert( name, value, 'E_SCENERY_OUTPUT' );

	}

	#assert( name, value, code ) {

		const validate = this.ajv.getSchema( `urn:urbe:engine:scenery:${name}` );
		if ( ! validate ) throw new SceneryError( code, `unknown scenery schema ${name}` );
		if ( validate( value ) ) return value;

		const details = validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` );
		throw new SceneryError( code, `${name} does not match its schema`, details );

	}

}
