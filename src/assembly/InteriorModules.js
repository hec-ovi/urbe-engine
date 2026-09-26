import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { sha256 } from './JsonFile.js';
import { validateInteriorModules } from './validators.js';
import { INTERIOR_ENTRY } from './interiorRunner.js';
import { share, sharedPath, sharedRoot } from './SharedResources.js';

/** Interior's furniture catalog, with the models its `modelUri` names beside it. */
export const PROPS_DIR = fileURLToPath( new URL( '../../../interior/src/assets/', import.meta.url ) );
/** What the shared store calls the set every furnished building draws from. */
export const MODULES_KIND = 'interior-modules';
/** The module catalog the world manifest points the game at, inside that folder. */
export const MODULES_FILE = 'modules.json';
/** The furniture catalog beside it, the second catalog `interior/building.json` names. */
export const PROPS_FILE = 'catalog.json';

/**
 * The shared interior resources: the room modules a floor is built from and the
 * furniture catalog its placements name. Every furnished building in every city
 * references the same pair, and the furniture with its models is 64 MB, so both
 * go into one folder in the shared store named for their own bytes and a world's
 * manifest binds those bytes. That folder is the resource base `building.json`
 * resolves `modules` and `props` against. The module set is built through
 * interior's own library on every publish, under a second and byte-identical
 * for identical inputs, so it is always the set the interior that furnished
 * the buildings draws with, and the store keeps one copy per distinct set.
 */
export class InteriorModules {

	/**
	 * @param dir a prebuilt module set to publish instead of building one; `URBE_INTERIOR_MODULES_DIR` names it
	 * @param propsDir the furniture catalog's folder; `URBE_INTERIOR_PROPS_DIR` overrides interior's
	 */
	constructor( dir = process.env.URBE_INTERIOR_MODULES_DIR || null,
		propsDir = process.env.URBE_INTERIOR_PROPS_DIR || PROPS_DIR ) {

		this.dir = dir;
		this.propsDir = propsDir;
		/** The manifest references, once both sets stand in the shared store. */
		this.references = null;

	}

	/**
	 * Puts both sets in the shared store once per run, where every city that
	 * furnishes a building reads the same copy. The furniture alone is 64 MB, so
	 * a world references it by hash instead of carrying it.
	 * @returns the manifest references `{ modules: { file, sha256, shared }, props: { file, sha256, shared } }`
	 * @throws AssemblyError E_INTERIOR_FAILED, which keeps the building closed
	 */
	async publish() {

		if ( this.references ) return this.references;

		mkdirSync( sharedRoot(), { recursive: true } );

		const staged = mkdtempSync( join( sharedRoot(), '.staging-' ) );

		try {

			if ( this.dir ) cpSync( this.dir, staged, { recursive: true } );
			else await this.#build( staged );

			const modules = this.#catalog( staged, MODULES_FILE );
			const errors = validateInteriorModules( modules.document );

			if ( errors.length ) {

				throw new AssemblyError( 'E_INTERIOR_FAILED',
					`interior modules schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

			}
			for ( const module of modules.document.modules ) if ( ! existsSync( join( staged, module.file ) ) ) {

				throw new AssemblyError( 'E_INTERIOR_FAILED', `interior module ${module.id} names a missing model ${module.file}` );

			}

			const props = this.#props( staged );
			// Model bytes are part of the identity too: a geometry/material edit can
			// leave a catalog (including its byte counts) unchanged.
			const identity = bundleHash( staged );
			const destination = join( sharedRoot(), sharedPath( MODULES_KIND, identity ) );
			if ( existsSync( destination ) ) repairBundle( staged, destination );
			const shared = share( MODULES_KIND, identity, staged, { move: true } );

			this.references = {
				modules: { ...modules.reference, shared },
				props: { ...props, shared }
			};

			return this.references;

		} finally { rmSync( staged, { recursive: true, force: true } ); }

	}

	/**
	 * The furniture catalog and every model it names, copied beside the modules.
	 * A `local-only` model is downloaded per machine and never shipped with
	 * Interior: an entry whose model this machine lacks leaves the published
	 * catalog, one warning names every such id, and its placements stand empty.
	 */
	#props( destination ) {

		const source = join( this.propsDir, PROPS_FILE );

		if ( ! existsSync( source ) ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `no furniture catalog at ${source}` );

		}

		const bytes = readFileSync( source );
		const document = parseCatalog( bytes, PROPS_FILE );

		if ( ! Array.isArray( document.assets ) ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `${PROPS_FILE} names no furniture assets` );

		}

		// The runtime reads each model relative to the published catalog, so
		// every model it names travels with it.
		const absent = [];

		for ( const asset of document.assets ) {

			if ( ! asset?.modelUri ) continue;

			const model = join( this.propsDir, asset.modelUri );

			if ( ! existsSync( model ) ) {

				if ( asset.availability === 'local-only' ) {

					absent.push( asset.id );
					continue;

				}
				throw new AssemblyError( 'E_INTERIOR_FAILED', `furniture ${asset.id} names a missing model ${asset.modelUri}` );

			}

			const target = join( destination, asset.modelUri );

			mkdirSync( dirname( target ), { recursive: true } );
			copyFileSync( model, target );

		}

		let published = bytes;

		if ( absent.length ) {

			console.warn( `interior furniture: ${absent.length} local-only models are not on this machine, so their placements stand empty: ${absent.join( ', ' )}` );
			const assets = document.assets.filter( ( asset ) => ! absent.includes( asset.id ) );
			published = Buffer.from( JSON.stringify( { ...document, assets }, null, 2 ) + '\n' );

		}

		writeFileSync( join( destination, PROPS_FILE ), published );

		return { file: PROPS_FILE, sha256: sha256( published ) };

	}

	/** One published catalog: its parsed document and the bytes the manifest binds. */
	#catalog( directory, file ) {

		const bytes = readFileSync( join( directory, file ) );

		return { document: parseCatalog( bytes, file ), reference: { file, sha256: sha256( bytes ) } };

	}

	/** The set published straight from the library. */
	async #build( destination ) {

		const { buildModules } = await import( INTERIOR_ENTRY );
		let built = null;

		try {

			built = await buildModules();

		} catch ( error ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `shared modules: ${error.code ?? error.name}: ${error.message}` );

		}

		rmSync( destination, { recursive: true, force: true } );
		mkdirSync( destination, { recursive: true } );
		for ( const [ file, bytes ] of built.files ) writeFileSync( join( destination, file ), bytes );
		writeFileSync( join( destination, 'modules.json' ), JSON.stringify( built.catalog ) + '\n' );

	}

}

function parseCatalog( bytes, file ) {

	try {

		return JSON.parse( bytes.toString( 'utf8' ) );

	} catch ( error ) {

		throw new AssemblyError( 'E_INTERIOR_FAILED', `${file} is not JSON: ${error.message}` );

	}

}

function* bundleFiles( directory, prefix = '' ) {

	for ( const entry of readdirSync( directory, { withFileTypes: true } ).sort( ( a, b ) => a.name < b.name ? - 1 : a.name > b.name ? 1 : 0 ) ) {

		const file = prefix + entry.name;
		if ( entry.isDirectory() ) yield* bundleFiles( join( directory, entry.name ), `${file}/` );
		else if ( entry.isFile() ) yield file;

	}

}

function bundleHash( directory ) {

	const hash = createHash( 'sha256' );
	for ( const file of bundleFiles( directory ) ) hash.update( `${file}\0${sha256( readFileSync( join( directory, file ) ) )}\0` );
	return hash.digest( 'hex' );

}

/** Repair an incomplete existing set with identical bytes, one atomic file rename at a time. */
function repairBundle( source, destination ) {

	for ( const file of bundleFiles( source ) ) {

		const from = join( source, file );
		const target = join( destination, file );
		if ( existsSync( target ) && sha256( readFileSync( from ) ) === sha256( readFileSync( target ) ) ) continue;
		mkdirSync( dirname( target ), { recursive: true } );
		const temporary = `${target}.repair-${randomUUID()}`;
		try {

			copyFileSync( from, temporary );
			renameSync( temporary, target );

		} finally { rmSync( temporary, { force: true } ); }

	}

}
