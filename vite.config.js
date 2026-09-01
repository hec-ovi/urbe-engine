import { defineConfig } from 'vite';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Sibling materials database (../materials/CONTRACT.md), served read-only
// under /materials/<theme>/... for the building viewer. Path is relative to
// this repo's location, never machine-specific.
const THEMES_DIR = fileURLToPath( new URL( '../materials/themes', import.meta.url ) );

const TYPES = { '.json': 'application/json', '.png': 'image/png' };

function materialsDatabase() {

	return {
		name: 'serve-materials-themes',
		configureServer( server ) {

			server.middlewares.use( '/materials', async ( req, res, next ) => {

				const urlPath = decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname );
				const filePath = normalize( join( THEMES_DIR, urlPath ) );
				const type = TYPES[ extname( filePath ) ];

				if ( ! filePath.startsWith( THEMES_DIR + sep ) || ! type ) return next();

				try {

					const data = await readFile( filePath );
					res.setHeader( 'Content-Type', type );
					res.end( data );

				} catch {

					next();

				}

			} );

		}
	};

}

export default defineConfig( {
	plugins: [ materialsDatabase() ],
	build: {
		target: 'esnext',
		chunkSizeWarningLimit: 2500
	}
} );
