import { existsSync, linkSync, lstatSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { copyFile, link as hardLink, mkdir, readdir, readlink, symlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/** Why a hard link cannot be made where a copy still can: another filesystem, the link limit, no link support. */
const UNLINKABLE = new Set( [ 'EXDEV', 'EMLINK', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP' ] );

/**
 * Clones a world folder, a city into its draft or a draft into a game, without
 * copying its bytes: every file of the clone is a hard link to the source's, so
 * a city, its draft and its games hold one copy of each file they share.
 *
 * A world file is never changed in place: its writers write beside the name
 * and rename over it (`replaceFile`, `writeJsonFile`, the Exterior workers,
 * `runInterior`, the library's saves), and a removal unlinks only the clone's
 * own name. So the world that writes a file is the only one that sees the new
 * bytes, and deleting one world never touches another.
 *
 * @param source a world folder
 * @param destination a path that does not exist yet
 * @param options.link makes one hard link, `fs.link` by default; a file it cannot link is copied
 */
export async function cloneWorld( source, destination, { link = hardLink } = {} ) {

	await mkdir( destination );

	await Promise.all( ( await readdir( source, { withFileTypes: true } ) ).map( async ( entry ) => {

		const from = join( source, entry.name );
		const to = join( destination, entry.name );

		if ( entry.isDirectory() ) return cloneWorld( from, to, { link } );
		if ( entry.isSymbolicLink() ) return symlink( await readlink( from ), to );

		try {

			await link( from, to );

		} catch ( error ) {

			if ( ! UNLINKABLE.has( error.code ) ) throw error;
			await copyFile( from, to );

		}

	} ) );

}

/**
 * Before a world republishes a document or a folder of them, makes every
 * staged file that holds the same bytes as the file it replaces a hard link to
 * that file. A draft republishes the city's documents, mostly unchanged, and
 * so keeps sharing them with the city instead of holding its own copy.
 * @param staged the file or folder about to be renamed over `published`
 */
export function linkUnchanged( staged, published ) {

	if ( ! existsSync( published ) ) return;

	const old = lstatSync( published );
	const fresh = lstatSync( staged );

	if ( fresh.isDirectory() && old.isDirectory() ) {

		for ( const name of readdirSync( staged ) ) linkUnchanged( join( staged, name ), join( published, name ) );

	} else if ( fresh.isFile() && old.isFile() && fresh.size === old.size && fresh.ino !== old.ino
		&& readFileSync( staged ).equals( readFileSync( published ) ) ) {

		const pending = join( dirname( staged ), `.${basename( staged )}.link` );

		// A file that cannot be linked keeps its own copy.
		try {

			linkSync( published, pending );
			renameSync( pending, staged );

		} catch {} finally { rmSync( pending, { force: true } ); }

	}

}
