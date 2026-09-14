import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AssemblyError } from './RequestAssembler.js';
import { fnv1a } from './hash.js';
import { sha256 } from './JsonFile.js';

const ENTRY = new URL( '../../../streets/src/index.ts', import.meta.url ).href;
const MATERIALS = fileURLToPath( new URL( '../../../materials/bindings/street-native.json', import.meta.url ) );

/** Generates from the exact prepared file and binds both published documents by their bytes. */
export async function buildStreetArtifacts( stage, atlas, options = {} ) {

	const blueprint = join( stage, 'blueprint.json' );
	const blueprintSha256 = sha256( readFileSync( blueprint ) );
	try {

		const { build } = await import( ENTRY );
		const output = await build( {
			blueprint,
			seed: options.seed ?? fnv1a( `${atlas.meta.seed}:streets` ),
			design: { version: 'native-1.0.0', wear: options.wear ?? 1 }
		}, { nativeMaterials: options.nativeMaterials ?? MATERIALS, outDir: join( stage, 'streets' ) } );
		if ( output.meta.blueprintEncoding !== 'json-file-bytes' || output.meta.blueprintHash !== blueprintSha256
			|| output.meta.architectureVersion !== atlas.meta.version || sha256( readFileSync( blueprint ) ) !== blueprintSha256 ) {

			throw new AssemblyError( 'E_STREETS_SOURCE_MISMATCH', 'native streets must bind the exact final staged blueprint bytes and version' );

		}
		return { file: 'streets/manifest.json', sha256: sha256( readFileSync( join( stage, 'streets', 'manifest.json' ) ) ), blueprintSha256 };

	} catch ( error ) {

		if ( error instanceof AssemblyError ) throw error;
		throw new AssemblyError( 'E_STREETS_BUILD', `${error.code ?? 'ERROR'}: ${error.message}` );

	}

}
