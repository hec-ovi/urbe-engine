import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { hashJson, openWorldArchive } from '../world-archive/index.js';
import { AssemblyError } from './RequestAssembler.js';

/** Reads ordinary JSON or a World Archive directory/index through its public reader. */
export async function loadBlueprint( path ) {

	const absolute = resolve( path );
	const directory = ( await stat( absolute ) ).isDirectory();
	const file = directory ? join( absolute, 'index.json' ) : absolute;
	const document = JSON.parse( await readFile( file, 'utf8' ) );
	if ( ! directory && document?.format !== 'urbe-world-archive' ) return { atlas: document, encoding: 'json', path: file };
	if ( basename( file ) !== 'index.json' ) throw new AssemblyError( 'E_REQUEST_INVALID', 'World Archive input must name index.json or its directory' );

	const archive = await openWorldArchive( dirname( file ) );
	const atlas = await archive.read();
	const binding = hashJson( atlas );
	if ( binding.sha256 !== archive.index.json.sha256 || binding.bytes !== archive.index.json.bytes ) {

		throw new AssemblyError( 'E_CONNECTIONS_SOURCE_MISMATCH', 'Atlas archive original-content binding differs from its reconstructed source' );

	}
	return { atlas, encoding: 'archive', path: file };

}
