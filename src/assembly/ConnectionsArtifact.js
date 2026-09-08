import { join } from 'node:path';
import { hashJson, writeWorldArchive } from '../world-archive/index.js';
import { AssemblyError } from './RequestAssembler.js';
import { validateConnectionsOutput } from './validators.js';
import { writeJsonFile } from './JsonFile.js';

export const CONNECTIONS_FILE = 'connections.json';

/** Captures one validated generation and its complete Atlas source binding. */
export class ConnectionsArtifact {

	#document;
	#source;
	#reference;

	constructor( atlas, connections ) {

		const errors = validateConnectionsOutput( connections );

		if ( errors.length ) {

			throw new AssemblyError( 'E_CONNECTIONS_INVALID',
				`connections schema: ${errors.map( ( error ) => `${error.instancePath || '/'} ${error.message}` ).join( '; ' )}` );

		}

		if ( connections.meta.seed !== atlas.meta.seed || connections.meta.atlasSeed !== atlas.meta.seed ) {

			throw new AssemblyError( 'E_CONNECTIONS_SOURCE_MISMATCH', 'connections seeds differ from the Atlas source' );

		}

		this.#document = structuredClone( connections );
		this.#source = hashJson( atlas );
		this.#reference = Object.freeze( {
			file: CONNECTIONS_FILE,
			sha256: hashJson( this.#document ).sha256,
			blueprintSha256: this.#source.sha256
		} );

	}

	/** Checks a bounded canonical hash or an archive's original-content binding. */
	referenceFor( binding ) {

		if ( binding.sha256 !== this.#source.sha256 || binding.bytes !== this.#source.bytes ) {

			throw new AssemblyError( 'E_CONNECTIONS_SOURCE_MISMATCH', 'Atlas content changed after Connections generation' );

		}

		return this.#reference;

	}

	write( dir ) {

		writeJsonFile( join( dir, CONNECTIONS_FILE ), this.#document );

	}

	writeArchive( dir, options ) {

		return writeWorldArchive( this.#document, dir, options );

	}

}
