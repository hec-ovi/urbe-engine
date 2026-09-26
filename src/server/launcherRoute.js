import { LibraryError } from '../library/index.js';
import { CreationError } from '../creation/index.js';
import { CreationJobs } from './CreationJobs.js';
import { LauncherService, LauncherServiceError } from './LauncherService.js';
import { BodyError, readJson, sendJson } from './routeHttp.js';

const METHODS = new Set( [
	'catalog', 'continueGame', 'exportGame', 'importGame', 'exportCity',
	'generateCity', 'generateInstances', 'generateQuests', 'createGame', 'saveCurrent'
] );
/** The largest launcher or creation request body: an imported game descriptor. */
const MAX_BYTES = 128 * 1024 * 1024;

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

					const request = await readJson( req, 'launcher', MAX_BYTES );
					if ( ! request || typeof request !== 'object' || ! METHODS.has( request.method ) ) {

						throw new LauncherServiceError( 'E_INVALID_REQUEST', 'unknown launcher method' );

					}
					const input = request.input;
					const result = request.method === 'catalog'
						? await launcher().catalog()
						: await launcher()[ request.method ]( input );
					sendJson( res, 200, result );

				} catch ( error ) {

					fail( res, error );

				}

			} );

			server.middlewares.use( '/api/creation-jobs', async ( req, res, next ) => {

				const path = new URL( req.url, 'http://localhost' ).pathname;
				try {

					if ( req.method === 'POST' && ( path === '' || path === '/' ) ) {

						return sendJson( res, 202, creationJobs().start( await readJson( req, 'creation job', MAX_BYTES ) ) );

					}
					if ( req.method === 'GET' && /^\/creation-[0-9a-f-]+$/.test( path ) ) return sendJson( res, 200, creationJobs().get( path.slice( 1 ) ) );
					return next();

				} catch ( error ) {

					fail( res, error );

				}

			} );

		}
	};

}

function fail( res, error ) {

	const known = error instanceof LibraryError || error instanceof LauncherServiceError || error instanceof CreationError || error instanceof BodyError;
	sendJson( res, known ? error.status ?? 400 : 500, { code: error.code ?? 'E_LAUNCHER', message: error.message } );

}
