import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { validateConnectionsOutput } from './validators.js';

export const CONNECTIONS_FILE = 'connections.json';

/** Captures one validated generation and its complete Atlas source binding. */
export class ConnectionsArtifact {

	#bytes;
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

		this.#bytes = JSON.stringify( connections ) + '\n';
		this.#reference = Object.freeze( {
			file: CONNECTIONS_FILE,
			sha256: sha256( this.#bytes ),
			blueprintSha256: sha256( JSON.stringify( atlas ) + '\n' )
		} );

	}

	/** Checks the exact blueprint bytes that OutDir will publish. */
	reference( blueprintBytes ) {

		if ( sha256( blueprintBytes ) !== this.#reference.blueprintSha256 ) {

			throw new AssemblyError( 'E_CONNECTIONS_SOURCE_MISMATCH', 'Atlas content changed after Connections generation' );

		}

		return this.#reference;

	}

	write( dir ) {

		writeFileSync( join( dir, CONNECTIONS_FILE ), this.#bytes );

	}

}

function sha256( bytes ) {

	return createHash( 'sha256' ).update( bytes, 'utf8' ).digest( 'hex' );

}
