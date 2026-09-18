import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { sha256 } from './JsonFile.js';
import { validateInteriorModules } from './validators.js';
import { INTERIOR_ENTRY } from './interiorRunner.js';

/** Where interior's `npm run modules -- --out out/modules` publishes the shared set. */
export const MODULES_DIR = fileURLToPath( new URL( '../../../interior/out/modules/', import.meta.url ) );
/** Interior's furniture catalog, with the models its `modelUri` names beside it. */
export const PROPS_DIR = fileURLToPath( new URL( '../../../interior/src/assets/', import.meta.url ) );
/** The folder every furnished building draws its geometry from, one per city. */
export const MODULES_FOLDER = 'interior-modules';
/** The module catalog the world manifest points the game at. */
export const MODULES_FILE = `${MODULES_FOLDER}/modules.json`;
/** The furniture catalog beside it, the second catalog `interior/building.json` names. */
export const PROPS_FILE = `${MODULES_FOLDER}/catalog.json`;

/**
 * The shared interior resources: the room modules a floor is built from and the
 * furniture catalog its placements name. Every furnished building references the
 * same pair, so a city copies both into one folder beside the world, the way the
 * piece kit is copied, and the manifest binds those exact catalog bytes. That
 * folder is the resource base `building.json` resolves `modules` and `props`
 * against. A machine that has not published the module set builds it in process.
 */
export class InteriorModules {

	/**
	 * @param dir the published module set; `URBE_INTERIOR_MODULES_DIR` overrides the sibling build
	 * @param propsDir the furniture catalog's folder; `URBE_INTERIOR_PROPS_DIR` overrides interior's
	 */
	constructor( dir = process.env.URBE_INTERIOR_MODULES_DIR || MODULES_DIR,
		propsDir = process.env.URBE_INTERIOR_PROPS_DIR || PROPS_DIR ) {

		this.dir = dir;
		this.propsDir = propsDir;
		/** The manifest references, once both sets stand beside the world. */
		this.references = null;

	}

	/**
	 * Copies both sets beside the world once per run.
	 * @returns the manifest references `{ modules: { file, sha256 }, props: { file, sha256 } }`
	 * @throws AssemblyError E_INTERIOR_FAILED, which keeps the building closed
	 */
	async publish( outDir ) {

		if ( this.references ) return this.references;

		const destination = join( outDir, MODULES_FOLDER );

		mkdirSync( outDir, { recursive: true } );

		if ( existsSync( join( this.dir, 'modules.json' ) ) ) {

			// A world built from the copy it already carries holds exactly these modules.
			if ( resolve( destination ) !== resolve( this.dir ) ) {

				rmSync( destination, { recursive: true, force: true } );
				cpSync( this.dir, destination, { recursive: true } );

			}

		} else await this.#build( destination );

		const modules = this.#catalog( destination, 'modules.json', MODULES_FILE );
		const errors = validateInteriorModules( modules.document );

		if ( errors.length ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED',
				`interior modules schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

		}

		this.references = { modules: modules.reference, props: this.#props( destination ) };

		return this.references;

	}

	/** The furniture catalog and every model it names, copied beside the modules. */
	#props( destination ) {

		const source = join( this.propsDir, 'catalog.json' );

		if ( ! existsSync( source ) ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `no furniture catalog at ${source}` );

		}

		copyFileSync( source, join( destination, 'catalog.json' ) );

		const { document, reference } = this.#catalog( destination, 'catalog.json', PROPS_FILE );

		if ( ! Array.isArray( document.assets ) ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `${PROPS_FILE} names no furniture assets` );

		}

		// Every id a placement can name has to resolve, so the models the catalog
		// publishes travel with it: the runtime reads them relative to this file.
		for ( const asset of document.assets ) {

			if ( ! asset?.modelUri ) continue;

			const model = join( this.propsDir, asset.modelUri );

			if ( ! existsSync( model ) ) {

				throw new AssemblyError( 'E_INTERIOR_FAILED', `furniture ${asset.id} names a missing model ${asset.modelUri}` );

			}

			const target = join( destination, asset.modelUri );

			mkdirSync( dirname( target ), { recursive: true } );
			copyFileSync( model, target );

		}

		return reference;

	}

	/** One published catalog: its parsed document and the bytes the manifest binds. */
	#catalog( destination, name, file ) {

		const bytes = readFileSync( join( destination, name ) );

		try {

			return { document: JSON.parse( bytes.toString( 'utf8' ) ), reference: { file, sha256: sha256( bytes ) } };

		} catch ( error ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `${file} is not JSON: ${error.message}` );

		}

	}

	/** The set published straight from the library, for a machine that has none on disk. */
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
