import { link, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { LibraryError } from './LibraryError.js';
import { compareStrings } from './canonicalJson.js';

const FILES = { cities: 'city.json', games: 'game.json' };
let temporarySequence = 0;

export class FileStore {

	constructor( outDir ) {

		this.outDir = resolve( outDir );

	}

	async listIds( kind ) {

		const root = this.#kindRoot( kind );
		const state = await pathState( root );
		if ( state === null ) return [];
		if ( state.isSymbolicLink() ) throw unsafePath( root );
		if ( ! state.isDirectory() ) throw storageError( `${root} is not a directory` );

		try {

			const entries = await readdir( root, { withFileTypes: true } );
			return entries.filter( ( entry ) => entry.isDirectory() ).map( ( entry ) => entry.name ).sort( compareStrings );

		} catch ( error ) {

			throw mapStorageError( error, `cannot list ${root}` );

		}

	}

	async hasDescriptor( kind, id ) {

		const directory = this.#descriptorDir( kind, id );
		const directoryState = await pathState( directory );
		if ( directoryState === null ) return false;
		if ( directoryState.isSymbolicLink() ) throw unsafePath( directory );
		if ( ! directoryState.isDirectory() ) return false;

		const file = join( directory, FILES[ kind ] );
		const fileState = await pathState( file );
		if ( fileState === null ) return false;
		if ( fileState.isSymbolicLink() ) throw unsafePath( file );
		return fileState.isFile();

	}

	async readDescriptor( kind, id ) {

		const directory = this.#descriptorDir( kind, id );
		const directoryState = await pathState( directory );
		if ( directoryState === null ) throw notFound( kind, id );
		if ( directoryState.isSymbolicLink() ) throw unsafePath( directory );
		if ( ! directoryState.isDirectory() ) throw notFound( kind, id );

		const file = join( directory, FILES[ kind ] );
		const fileState = await pathState( file );
		if ( fileState === null ) throw notFound( kind, id );
		if ( fileState.isSymbolicLink() ) throw unsafePath( file );
		if ( ! fileState.isFile() ) throw storageError( `${file} is not a file` );

		try {

			return await readFile( file, 'utf8' );

		} catch ( error ) {

			throw mapStorageError( error, `cannot read ${file}` );

		}

	}

	async writeGame( id, text ) {

		return this.#writeDescriptor( 'games', id, text, true );

	}

	async writeCity( id, text ) {

		return this.#writeDescriptor( 'cities', id, text, false );

	}

	async #writeDescriptor( kind, id, text, replace ) {

		const kindRoot = this.#kindRoot( kind );
		await this.#ensureDirectory( this.outDir );
		await this.#ensureDirectory( kindRoot );

		const directory = this.#descriptorDir( kind, id );
		await this.#ensureDirectory( directory );
		const file = join( directory, FILES[ kind ] );
		await assertWritableFile( file );

		const temporary = join( directory, `.${FILES[ kind ]}.${process.pid}.${temporarySequence ++}.tmp` );
		try {

			await writeFile( temporary, text, { encoding: 'utf8', flag: 'wx' } );
			if ( replace ) await rename( temporary, file );
			else {

				await link( temporary, file );
				await unlink( temporary );

			}

		} catch ( error ) {

			await unlink( temporary ).catch( () => {} );
			if ( error instanceof LibraryError ) throw error;
			if ( ! replace && error.code === 'EEXIST' ) throw new LibraryError( 'E_EXISTS', `city ${id} already exists` );
			throw mapStorageError( error, `cannot save ${file}` );

		}

	}

	#kindRoot( kind ) {

		if ( ! Object.hasOwn( FILES, kind ) ) throw storageError( `unknown library kind ${kind}` );
		return join( this.outDir, kind );

	}

	#descriptorDir( kind, id ) {

		return join( this.#kindRoot( kind ), id );

	}

	async #ensureDirectory( path ) {

		const state = await pathState( path );
		if ( state ) {

			if ( state.isSymbolicLink() ) throw unsafePath( path );
			if ( ! state.isDirectory() ) throw storageError( `${path} is not a directory` );
			return;

		}

		try {

			await mkdir( path, { recursive: true } );

		} catch ( error ) {

			throw mapStorageError( error, `cannot create ${path}` );

		}

	}

}

async function assertWritableFile( path ) {

	const state = await pathState( path );
	if ( state?.isSymbolicLink() ) throw unsafePath( path );
	if ( state && ! state.isFile() ) throw storageError( `${path} is not a file` );

}

async function pathState( path ) {

	try {

		return await lstat( path );

	} catch ( error ) {

		if ( error.code === 'ENOENT' ) return null;
		throw mapStorageError( error, `cannot inspect ${path}` );

	}

}

function notFound( kind, id ) {

	const singular = kind === 'cities' ? 'city' : 'game';
	return new LibraryError( `E_${singular.toUpperCase()}_NOT_FOUND`, `${singular} ${id} was not found` );

}

function unsafePath( path ) {

	return new LibraryError( 'E_UNSAFE_PATH', `${path} crosses a symbolic link` );

}

function storageError( message ) {

	return new LibraryError( 'E_STORAGE', message );

}

function mapStorageError( error, context ) {

	if ( error instanceof LibraryError ) return error;
	return storageError( `${context}: ${error.message}` );

}
