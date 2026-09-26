import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { talkRoute } from './src/server/talkRoute.js';
import { voiceRoute } from './src/server/voiceRoute.js';
import { buildingRoute } from './src/server/buildingRoute.js';
import { launcherRoute } from './src/server/launcherRoute.js';
import { createWorldCreation } from './src/creation/index.js';
import { hitchReportPlugin } from './src/game/debug/hitchReportPlugin.js';

// Sibling materials database (../materials/CONTRACT.md), served read-only
// under /materials/<theme>/... for the building viewer and the game. Path is
// relative to this repo's location, never machine-specific.
const ROOT = fileURLToPath( new URL( '.', import.meta.url ) );
const THEMES_DIR = fileURLToPath( new URL( '../materials/themes', import.meta.url ) );
const TEST_WORKERS = Math.max( 1, Math.floor( availableParallelism() / 4 ) );
const BASIS_DIR = fileURLToPath( new URL( './node_modules/three/examples/jsm/libs/basis', import.meta.url ) );
const BINDINGS_DIR = fileURLToPath( new URL( '../materials/bindings', import.meta.url ) );

// Sibling atlas city blueprints (../atlas/CONTRACT.md), served read-only under
// /atlas/<sample>.json so the game can load a world by name. Override with
// URBE_ATLAS_DIR to play a directory of blueprints from somewhere else.
const ATLAS_DIR = normalize( process.env.URBE_ATLAS_DIR ?? fileURLToPath( new URL( '../atlas/samples', import.meta.url ) ) );

// CC0 character, animation and vehicle packs. Not in the repo: they live in
// the machine's model store. Override with URBE_MODELS_DIR.
const MODELS_DIR = normalize( process.env.URBE_MODELS_DIR ?? join( homedir(), 'models', 'quaternius' ) );
// Creation names themed cities and writes stories through the machine's
// OpenAI-compatible model server; without LLM_BASE_URL it builds unnamed
// cities with the recorded story only.
const creation = createWorldCreation( {
	engineRoot: ROOT,
	atlasRoot: fileURLToPath( new URL( '../atlas', import.meta.url ) ),
	questsRoot: fileURLToPath( new URL( '../quests', import.meta.url ) ),
	namingRoot: fileURLToPath( new URL( '../naming', import.meta.url ) ),
	themesDir: THEMES_DIR,
	outDir: join( ROOT, 'out' ),
	...( process.env.LLM_BASE_URL ? {
		model: { baseUrl: process.env.LLM_BASE_URL, ...( process.env.LLM_MODEL ? { model: process.env.LLM_MODEL } : {} ) }
	} : {} )
} );

const TYPES = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.bin': 'application/octet-stream'
};

/** Read-only static mount of one directory under one URL prefix. */
function mount( name, prefix, dir ) {

	return {
		name,
		configureServer( server ) {

			server.middlewares.use( prefix, async ( req, res, next ) => {

				const urlPath = decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname );
				const filePath = normalize( join( dir, urlPath ) );
				const type = TYPES[ extname( filePath ) ];

				if ( ! filePath.startsWith( dir + sep ) || ! type ) return next();

				try {

					const data = await readFile( filePath );
					res.setHeader( 'Content-Type', type );
					// A material map keeps its file name across releases; never let the browser keep a stale one.
					res.setHeader( 'Cache-Control', 'no-store' );
					res.end( data );

				} catch {

					next();

				}

			} );

		}
	};

}

export default defineConfig( ( { mode } ) => ( {
	// Tests, like batches, take a quarter of the machine: a full pool pins the package near 100 C.
	// They publish into a shared store of their own, never engine/out/shared.
	test: { maxWorkers: TEST_WORKERS, globalSetup: [ 'src/assembly/test-store.js' ] },
	plugins: [
		hitchReportPlugin( join( ROOT, 'out', 'diagnostics' ) ),
		mount( 'serve-materials-bindings', '/materials/bindings', BINDINGS_DIR ),
		mount( 'serve-materials-themes', '/materials', THEMES_DIR ),
		mount( 'serve-basis-transcoder', '/basis', BASIS_DIR ),
		mount( 'serve-atlas-samples', '/atlas', ATLAS_DIR ),
		mount( 'serve-models', '/models', MODELS_DIR ),
		buildingRoute( ROOT, ATLAS_DIR ),
		launcherRoute( ROOT, creation ),
		talkRoute( ROOT ),
		voiceRoute()
	],
	server: {
		// Play mode owns 5175: every recorded play URL names it, and a free
		// lower port must never move the game.
		...( mode === 'play' ? { port: 5175, strictPort: true } : {} ),
		forwardConsole: { unhandledErrors: true, logLevels: [ 'error', 'warn', 'info' ] },
		// The connections library is consumed as TypeScript source from the
		// sibling repo (../connections/CONTRACT.md is the coupling surface).
		fs: { allow: [ '..' ] },
		// Assembled worlds under out/ are served, never watched: a city is
		// thousands of files and the watcher would run out of inotify handles.
		watch: mode === 'play' ? null : { ignored: [ '**/out/**' ] }
	},
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 4000
	}
} ) );
