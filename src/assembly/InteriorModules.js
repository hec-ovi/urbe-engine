import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AssemblyError } from './RequestAssembler.js';
import { sha256 } from './JsonFile.js';
import { validateInteriorModules } from './validators.js';
import { INTERIOR_ENTRY } from './interiorRunner.js';
import { share, sharedRoot } from './SharedResources.js';

/** Where interior's `npm run modules -- --out out/modules` publishes the shared set. */
export const MODULES_DIR = fileURLToPath( new URL( '../../../interior/out/modules/', import.meta.url ) );
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
 * resolves `modules` and `props` against. A machine that has not published the
 * module set builds it in process.
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

			if ( existsSync( join( this.dir, 'modules.json' ) ) ) cpSync( this.dir, staged, { recursive: true } );
			else await this.#build( staged );

			const modules = this.#catalog( staged, MODULES_FILE );
			const errors = validateInteriorModules( modules.document );

			if ( errors.length ) {

				throw new AssemblyError( 'E_INTERIOR_FAILED',
					`interior modules schema: ${errors.map( ( e ) => `${e.instancePath || '/'} ${e.message}` ).join( '; ' )}` );

			}

			const props = this.#props( staged );
			// One folder for the pair, named for both catalogs: a world that binds
			// these module bytes binds exactly this furniture too.
			const shared = share( MODULES_KIND, sha256( `${modules.reference.sha256}${props.sha256}` ), staged, { move: true } );

			this.references = {
				modules: { ...modules.reference, shared },
				props: { ...props, shared }
			};

			return this.references;

		} finally { rmSync( staged, { recursive: true, force: true } ); }

	}

	/** The furniture catalog and every model it names, copied beside the modules. */
	#props( destination ) {

		const source = join( this.propsDir, 'catalog.json' );

		if ( ! existsSync( source ) ) {

			throw new AssemblyError( 'E_INTERIOR_FAILED', `no furniture catalog at ${source}` );

		}

		copyFileSync( source, join( destination, PROPS_FILE ) );

		const { document, reference } = this.#catalog( destination, PROPS_FILE );

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
	#catalog( directory, file ) {

		const bytes = readFileSync( join( directory, file ) );

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
