import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import atlas from '../../../assembly/native-city.fixture.json' with { type: 'json' };

const ENTRY = new URL( '../../../../../streets/src/index.ts', import.meta.url ).href;
const MATERIALS = fileURLToPath( new URL( '../../../../../materials/bindings/street-native.json', import.meta.url ) );

let built = null;

/**
 * The real bundle Streets publishes for the fixture city, built once per test
 * process. Runtime cases read the kit, its pieces and its placements as the
 * producer writes them, never a hand-made stand-in.
 *
 * @returns { root, manifest } where root holds `streets/` beside `manifest.json`
 */
export function streetBundle() {

	if ( ! built ) built = build();

	return built;

}

async function build() {

	const directory = mkdtempSync( join( tmpdir(), 'street-bundle-' ) );
	process.once( 'exit', () => rmSync( directory, { recursive: true, force: true } ) );

	const blueprint = join( directory, 'blueprint.json' );
	writeFileSync( blueprint, JSON.stringify( atlas, null, 2 ) + '\n' );
	const { build: streets } = await import( ENTRY );
	await streets( { blueprint, seed: 7, design: { version: 'native-1.0.0', wear: 1 } },
		{ nativeMaterials: MATERIALS, outDir: join( directory, 'bundle' ) } );

	const root = join( directory, 'bundle' );

	return { root, manifest: JSON.parse( readFileSync( join( root, 'manifest.json' ), 'utf8' ) ) };

}
