import { createHash } from 'node:crypto';
import { closeSync, openSync, writeSync } from 'node:fs';
import { iterateJsonBytes } from '../world-archive/index.js';

/** Compact JSON plus LF, written without allocating a whole document string. */
export function writeJsonFile( path, value ) {

	const descriptor = openSync( path, 'w' );
	try {

		for ( const bytes of iterateJsonBytes( value ) ) {

			let offset = 0;
			while ( offset < bytes.byteLength ) offset += writeSync( descriptor, bytes, offset, bytes.byteLength - offset );

		}

	} finally { closeSync( descriptor ); }

}

/** Exact file bytes, including whitespace. */
export function sha256( bytes ) {

	return createHash( 'sha256' ).update( bytes ).digest( 'hex' );

}
