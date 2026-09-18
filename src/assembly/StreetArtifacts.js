import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblyError } from './RequestAssembler.js';
import { fnv1a } from './hash.js';
import { sha256 } from './JsonFile.js';
import { share, sharedRoot, take } from './SharedResources.js';

const ENTRY = new URL( '../../../streets/src/index.ts', import.meta.url ).href;
const MATERIALS = fileURLToPath( new URL( '../../../materials/bindings/street-native.json', import.meta.url ) );
const FILES = { kit: 'streets/kit.json', placements: 'streets/placements.json' };

/** Generates from the exact prepared file and binds the published manifest and kit by their bytes. */
export async function buildStreetArtifacts( stage, atlas, options = {} ) {

	const blueprint = join( stage, 'blueprint.json' );
	const blueprintSha256 = sha256( readFileSync( blueprint ) );
	const bundle = join( stage, '.streets-bundle' );
	try {

		const { build } = await import( ENTRY );
		const output = await build( {
			blueprint,
			seed: options.seed ?? fnv1a( `${atlas.meta.seed}:streets` ),
			design: { version: 'native-1.0.0', wear: options.wear ?? 1 }
		}, { nativeMaterials: options.nativeMaterials ?? MATERIALS, outDir: bundle } );
		if ( output.files?.kit !== FILES.kit || output.files?.placements !== FILES.placements ) {

			throw new AssemblyError( 'E_STREETS_BUILD', `streets published ${JSON.stringify( output.files )} instead of the kit and placement documents` );

		}
		if ( output.meta.blueprintEncoding !== 'json-file-bytes' || output.meta.blueprintHash !== blueprintSha256
			|| output.meta.architectureVersion !== atlas.meta.version || sha256( readFileSync( blueprint ) ) !== blueprintSha256 ) {

			throw new AssemblyError( 'E_STREETS_SOURCE_MISMATCH', 'native streets must bind the exact final staged blueprint bytes and version' );

		}
		const { sha256: manifest, kitSha256 } = flatten( stage, bundle );
		return { file: 'streets/manifest.json', sha256: manifest, kitSha256, blueprintSha256 };

	} catch ( error ) {

		rmSync( bundle, { recursive: true, force: true } );
		if ( error instanceof AssemblyError ) throw error;
		throw new AssemblyError( 'E_STREETS_BUILD', `${error.code ?? 'ERROR'}: ${error.message}` );

	}

}

/**
 * Streets writes the manifest beside a `streets/` directory of kit, placements and pieces.
 * The world publishes that directory as its own `streets/`, so the manifest joins it there
 * and the kit paths it names resolve from the world root.
 */
function flatten( stage, bundle ) {

	const published = join( stage, 'streets' );
	renameSync( join( bundle, 'streets' ), published );
	renameSync( join( bundle, 'manifest.json' ), join( published, 'manifest.json' ) );
	rmSync( bundle, { recursive: true, force: true } );
	return {
		sha256: sha256( readFileSync( join( published, 'manifest.json' ) ) ),
		kitSha256: sha256( readFileSync( join( published, 'kit.json' ) ) )
	};

}

/**
 * Moves the street kit and its piece files into the shared store, so a world
 * ships only the manifest and the placements that are its own.
 * @returns the kit's path under the store, which the manifest names
 */
export function shareStreetKit( published, kitSha256 ) {

	mkdirSync( sharedRoot(), { recursive: true } );

	const staged = mkdtempSync( join( sharedRoot(), '.streets-kit-' ) );

	try {

		for ( const name of [ 'kit.json', 'pieces' ] ) {

			if ( existsSync( join( published, name ) ) ) take( join( published, name ), join( staged, name ) );

		}

		return share( 'streets-kit', kitSha256, staged, { move: true } );

	} finally { rmSync( staged, { recursive: true, force: true } ); }

}
