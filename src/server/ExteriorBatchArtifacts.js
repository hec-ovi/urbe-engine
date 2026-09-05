import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { byteHash } from './ExteriorBuildBoundary.js';

/** Admits final batch files against the submitted source and published schemas. */
export class ExteriorBatchArtifacts {

	constructor( boundary ) {

		this.boundary = boundary;

	}

	read( outDir, blueprint, completed ) {

		const manifest = JSON.parse( readFileSync( join( outDir, 'manifest.json' ), 'utf8' ) );
		const blueprintBytes = readFileSync( join( outDir, 'blueprint.json' ) );
		const carried = JSON.parse( blueprintBytes.toString( 'utf8' ) );
		if ( ! this.boundary.manifest( manifest ) ) throw new Error( `batch manifest fails Assembly schema: ${schemaErrors( this.boundary.manifest )}` );
		if ( manifest.seed !== blueprint.meta.seed || manifest.atlasVersion !== blueprint.meta.version ||
			! isDeepStrictEqual( [ ...manifest.parcels ].sort(), blueprint.parcels.map( ( parcel ) => parcel.id ).sort() ) ||
			manifest.interiors.length || Object.keys( manifest.floors ).length || completed !== blueprint.parcels.length ||
			! isDeepStrictEqual( carried, blueprint ) ) throw new Error( 'batch artifacts do not match the requested blueprint and complete shell set' );

		if ( Object.hasOwn( manifest, 'connections' ) ) this.#connections( outDir, manifest.connections, blueprintBytes, blueprint );
		return manifest;

	}

	#connections( outDir, reference, blueprintBytes, blueprint ) {

		const path = join( outDir, reference.file );
		const stat = lstatSync( path );
		if ( ! stat.isFile() || stat.size === 0 ) throw new Error( 'Connections artifact must be a nonempty regular file' );
		const bytes = readFileSync( path );
		if ( byteHash( bytes ) !== reference.sha256 ) throw new Error( 'Connections artifact byte hash does not match its manifest' );
		if ( byteHash( blueprintBytes ) !== reference.blueprintSha256 ) throw new Error( 'Connections source byte hash does not match the carried blueprint' );
		const connections = JSON.parse( bytes.toString( 'utf8' ) );
		if ( ! this.boundary.connections( connections ) ) throw new Error( `Connections artifact fails its output schema: ${schemaErrors( this.boundary.connections )}` );
		if ( connections.meta.seed !== blueprint.meta.seed || connections.meta.atlasSeed !== blueprint.meta.seed ) {

			throw new Error( 'Connections artifact seeds do not match the submitted blueprint' );

		}

	}

}

function schemaErrors( validate ) {

	return validate.errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' );

}
