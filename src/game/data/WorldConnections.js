import Ajv2020 from 'ajv/dist/2020.js';
import outputSchema from '../../../../connections/schemas/output.schema.json';
import linkSchema from '../../../../connections/schemas/link.schema.json';
import apertureSchema from '../../../../connections/schemas/aperture.schema.json';
import networksSchema from '../../../../connections/schemas/networks.schema.json';

// Resolve the published relative IDs within the local schema family.
const schema = structuredClone( outputSchema );
schema.properties.links.items.$ref = './link';
schema.properties.apertures.items.$ref = './aperture';
schema.properties.networks.$ref = './networks';
const ajv = new Ajv2020( { allErrors: true, strict: true } );
const validate = ajv.addSchema( [ linkSchema, apertureSchema, networksSchema ] ).compile( schema );

/** Reads Assembly's exact source-bound artifact; older manifests generate on demand. */
export async function loadWorldConnections( blueprint, reference, readDocument ) {

	if ( reference === undefined ) {

		const { runConnections } = await import( '../../assembly/connectionsRunner.js' );
		return runConnections( blueprint.data, { seed: blueprint.data.meta.seed } );

	}

	try {

		if ( await sha256( blueprint.bytes ) !== reference.blueprintSha256 ) throw new Error( 'blueprint byte hash mismatch' );
		const document = await readDocument( reference.file );
		if ( await sha256( document.bytes ) !== reference.sha256 ) throw new Error( 'Connections byte hash mismatch' );
		if ( ! validate( document.data ) ) throw new Error( ajv.errorsText( validate.errors ) );
		const { meta } = document.data;
		if ( meta.seed !== blueprint.data.meta.seed || meta.atlasSeed !== blueprint.data.meta.seed ) throw new Error( 'Connections source seeds mismatch' );
		return document.data;

	} catch ( error ) {

		throw Object.assign( new Error( `E_WORLD_CONNECTIONS: ${error.message}; re-run assemble-city` ), { code: 'E_WORLD_CONNECTIONS', cause: error } );

	}

}

async function sha256( bytes ) {

	const digest = await crypto.subtle.digest( 'SHA-256', bytes );
	return Array.from( new Uint8Array( digest ), ( byte ) => byte.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}
