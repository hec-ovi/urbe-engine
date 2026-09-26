import { LibraryError } from '../library/index.js';
import { CreationError } from '../creation/index.js';
import { CreationJobs } from './CreationJobs.js';
import { LauncherService, LauncherServiceError } from './LauncherService.js';

const METHODS = new Set( [
	'catalog', 'continueGame', 'exportGame', 'importGame', 'exportCity',
	'generateCity', 'generateInstances', 'generateQuests', 'createGame', 'saveCurrent'
] );

/**
 * POST /api/launcher invokes one closed launcher service operation and answers
 * when it is done. POST /api/creation-jobs queues one creation stage and
 * answers with its job at once; GET /api/creation-jobs/<id> reads it.
 */
export function launcherRoute( engineRoot, creation = null, service = null, jobs = null ) {

	const launcher = () => service ??= new LauncherService( { outDir: `${engineRoot}/out`, creation } );
	const creationJobs = () => jobs ??= new CreationJobs( { service: launcher(), creation } );

	return {
		name: 'launcher-route',
		configureServer( server ) {

			server.middlewares.use( '/api/launcher', async ( req, res, next ) => {

				if ( req.method !== 'POST' ) return next();
				try {

					const request = JSON.parse( await readBody( req ) );
					if ( ! request || typeof request !== 'object' || ! METHODS.has( request.method ) ) {

						throw new LauncherServiceError( 'E_INVALID_REQUEST', 'unknown launcher method' );

					}
					const input = request.input;
					const result = request.method === 'catalog'
						? await launcher().catalog()
						: await launcher()[ request.method ]( input );
					send( res, 200, result );

				} catch ( error ) {

					fail( res, error );

				}

			} );

			server.middlewares.use( '/api/creation-jobs', async ( req, res, next ) => {

				const path = new URL( req.url, 'http://localhost' ).pathname;
				try {

					if ( req.method === 'POST' && ( path === '' || path === '/' ) ) {

						return send( res, 202, creationJobs().start( JSON.parse( await readBody( req ) ) ) );

					}
					if ( req.method === 'GET' && /^\/creation-[0-9a-f-]+$/.test( path ) ) return send( res, 200, creationJobs().get( path.slice( 1 ) ) );
					return next();

				} catch ( error ) {

					fail( res, error );

				}

			} );

		}
	};

}

function readBody( req ) {

	return new Promise( ( resolve, reject ) => {

		let text = '';
		req.on( 'data', ( chunk ) => text += chunk );
		req.on( 'end', () => resolve( text ) );
		req.on( 'error', reject );

	} );

}

function fail( res, error ) {

	const malformed = error instanceof SyntaxError;
	const known = error instanceof LibraryError || error instanceof LauncherServiceError || error instanceof CreationError;
	send( res, malformed ? 400 : known ? error.status ?? 400 : 500, {
		code: malformed ? 'E_INVALID_REQUEST' : error.code ?? 'E_LAUNCHER',
		message: malformed ? 'request body is not valid JSON' : error.message
	} );

}

function send( res, status, payload ) {

	res.statusCode = status;
	res.setHeader( 'Content-Type', 'application/json' );
	res.setHeader( 'Cache-Control', 'no-store' );
	res.end( JSON.stringify( payload ) );

}
