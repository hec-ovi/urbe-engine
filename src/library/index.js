import { CatalogLibrary } from './src/CatalogLibrary.js';
import { FileStore } from './src/FileStore.js';
import { LibraryError } from './src/LibraryError.js';
import { SchemaBoundary } from './src/SchemaBoundary.js';

/** Creates the filesystem-backed city and game catalog rooted at an `out` directory. */
export function createLibrary( config = {} ) {

	const boundary = new SchemaBoundary();
	boundary.assert( 'library-config', config, 'E_INVALID_REQUEST', 'library configuration' );
	return new CatalogLibrary( new FileStore( config.outDir ?? 'out' ), boundary );

}

export { LibraryError };
