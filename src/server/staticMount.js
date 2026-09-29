import { open } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

/** What the sibling stores publish: catalogs, maps (PNG masters and their KTX2 builds) and models. */
export const FILE_TYPES = {
	'.json': 'application/json',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.ktx2': 'image/ktx2',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
	'.bin': 'application/octet-stream'
};

/**
 * three's Basis transcoder, which turns a .ktx2 map into the GPU's own format
 * in a worker: its script and its WebAssembly, and nothing else from its folder.
 */
export const TRANSCODER_TYPES = {
	'.js': 'text/javascript',
	'.wasm': 'application/wasm'
};

/**
 * Vite plugin: a read-only static mount of one directory under one URL prefix.
 *
 * A file of a served type that is not there answers 404, never the page: a
 * map the catalog publishes before its build output exists falls back to its
 * master at once instead of being handed index.html to decode.
 *
 * A map keeps its file name across materials releases, so the browser keeps
 * its copy and asks each time whether it is still current (no-cache with an
 * ETag of the file's size and modification time): an unchanged file costs a
 * 304 and a rewritten one arrives in full, so nothing stale is ever drawn and
 * nothing unchanged is downloaded twice.
 */
export function staticMount( name, prefix, dir, types = FILE_TYPES ) {

	return {
		name,
		configureServer( server ) {

			server.middlewares.use( prefix, ( req, res, next ) => {

				if ( req.method !== 'GET' && req.method !== 'HEAD' ) return next();

				const urlPath = decodeURIComponent( new URL( req.url, 'http://localhost' ).pathname );
				const filePath = normalize( join( dir, urlPath ) );
				const type = types[ extname( filePath ) ];

				if ( ! filePath.startsWith( dir + sep ) || ! type ) return next();
				send( req, res, filePath, type );

			} );

		}
	};

}

async function send( req, res, filePath, type ) {

	const handle = await open( filePath ).catch( () => null );
	if ( ! handle ) return missing( res );

	try {

		// One open file for the tag and the bytes, so a build renaming a new
		// map into place never pairs the one with the other.
		const file = await handle.stat();
		if ( ! file.isFile() ) return missing( res );
		const tag = `W/"${file.size.toString( 16 )}-${Math.round( file.mtimeMs * 1000 ).toString( 16 )}"`;
		res.setHeader( 'Cache-Control', 'no-cache' );
		res.setHeader( 'ETag', tag );
		if ( ( req.headers[ 'if-none-match' ] ?? '' ).split( /\s*,\s*/ ).includes( tag ) ) {

			res.statusCode = 304;
			return res.end();

		}
		res.setHeader( 'Content-Type', type );
		res.setHeader( 'Content-Length', file.size );
		res.end( req.method === 'HEAD' ? undefined : await handle.readFile() );

	} catch {

		if ( res.headersSent ) res.destroy();
		else missing( res );

	} finally {

		await handle.close().catch( () => {} );

	}

}

function missing( res ) {

	res.statusCode = 404;
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end();

}
