import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { talkRoute } from './src/server/talkRoute.js';
import { buildingRoute } from './src/server/buildingRoute.js';

// Sibling materials database (../materials/CONTRACT.md), served read-only
// under /materials/<theme>/... for the building viewer and the game. Path is
// relative to this repo's location, never machine-specific.
const ROOT = fileURLToPath( new URL( '.', import.meta.url ) );
const THEMES_DIR = fileURLToPath( new URL( '../materials/themes', import.meta.url ) );

// Sibling atlas city blueprints (../atlas/CONTRACT.md), served read-only under
// /atlas/<sample>.json so the game can load a world by name. Override with
// URBE_ATLAS_DIR to play a directory of blueprints from somewhere else.
const ATLAS_DIR = normalize( process.env.URBE_ATLAS_DIR ?? fileURLToPath( new URL( '../atlas/samples', import.meta.url ) ) );

// CC0 character, animation and vehicle packs. Not in the repo: they live in
// the machine's model store. Override with URBE_MODELS_DIR.
const MODELS_DIR = normalize( process.env.URBE_MODELS_DIR ?? join( homedir(), 'models', 'quaternius' ) );

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

export default defineConfig( {
	plugins: [
		mount( 'serve-materials-themes', '/materials', THEMES_DIR ),
		mount( 'serve-atlas-samples', '/atlas', ATLAS_DIR ),
		mount( 'serve-models', '/models', MODELS_DIR ),
		buildingRoute( ROOT, ATLAS_DIR ),
		talkRoute( ROOT )
	],
	server: {
		// The connections library is consumed as TypeScript source from the
		// sibling repo (../connections/CONTRACT.md is the coupling surface).
		fs: { allow: [ '..' ] },
		// Assembled worlds under out/ are served, never watched: a city is
		// thousands of files and the watcher would run out of inotify handles.
		watch: { ignored: [ '**/out/**' ] }
	},
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 4000
	}
} );
