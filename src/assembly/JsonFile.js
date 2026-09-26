import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { iterateJsonBytes } from '../world-archive/index.js';

/**
 * Compact JSON plus LF, written without allocating a whole document string.
 * The file replaces its name whole, as `replaceFile` does.
 */
export function writeJsonFile( path, value ) {

	replacing( path, ( pending ) => {

		const descriptor = openSync( pending, 'wx' );
		try {

			for ( const bytes of iterateJsonBytes( value ) ) {

				let offset = 0;
				while ( offset < bytes.byteLength ) offset += writeSync( descriptor, bytes, offset, bytes.byteLength - offset );

			}

		} finally { closeSync( descriptor ); }

	} );

}

/**
 * Writes a file beside its name and renames it over the name, so the bytes a
 * name held are never changed in place. Worlds cloned by hard links share each
 * file until one of them writes it, and then only that world sees the new
 * bytes; a crash leaves the old file or the new one, never half of either.
 */
export function replaceFile( path, bytes ) {

	replacing( path, ( pending ) => writeFileSync( pending, bytes, { flag: 'wx' } ) );

}

function replacing( path, write ) {

	const pending = join( dirname( path ), `.${basename( path )}.${randomUUID()}.tmp` );
	try {

		write( pending );
		renameSync( pending, path );

	} finally { rmSync( pending, { force: true } ); }

}

/** Exact file bytes, including whitespace. */
export function sha256( bytes ) {

	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );

}
