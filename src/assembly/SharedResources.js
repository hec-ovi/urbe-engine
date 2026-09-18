import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Where every world's shared resources stand, one copy per distinct set. */
export const SHARED_DIR = fileURLToPath( new URL( '../../out/shared/', import.meta.url ) );
/** How much of a set's hash names its folder; enough that two sets never collide. */
const PREFIX = 16;

/**
 * Resources a world references instead of carrying.
 *
 * The piece kit, the street kit and the interior modules with their furniture
 * are the same bytes for every city built from the same boxes, and the
 * furniture alone is 64 MB. So each set is published once under the hash of
 * what it holds, and a world's manifest names it by that hash: a hundred
 * cities on this machine share one copy, and a set nothing points at any more
 * is a folder to delete rather than a rebuild.
 *
 * `URBE_SHARED_DIR` moves the store off the engine's own `out/`.
 */
export function sharedRoot() {

	return process.env.URBE_SHARED_DIR || SHARED_DIR;

}

/** What a set of these bytes is called under the store. */
export function sharedPath( kind, sha256 ) {

	return `${kind}/${sha256.slice( 0, PREFIX )}`;

}

/**
 * Puts one directory in the store under the hash of what it holds, once. A set
 * that is already there is left exactly as it stands.
 * @param move true to take the source directory rather than copy it
 * @returns its path under the store, which is what the manifest names
 */
export function share( kind, sha256, source, { move = false } = {} ) {

	const path = sharedPath( kind, sha256 );
	const destination = join( sharedRoot(), path );

	if ( existsSync( destination ) ) {

		if ( move ) rmSync( source, { recursive: true, force: true } );
		return path;

	}

	mkdirSync( dirname( destination ), { recursive: true } );
	take( source, destination, move );

	return path;

}

/** Moves or copies one path, falling back to a copy across filesystems. */
export function take( source, destination, move = true ) {

	try {

		if ( move ) renameSync( source, destination );
		else cpSync( source, destination, { recursive: true } );

	} catch ( error ) {

		if ( ! move || error.code !== 'EXDEV' ) throw error;
		cpSync( source, destination, { recursive: true } );
		rmSync( source, { recursive: true, force: true } );

	}

}
